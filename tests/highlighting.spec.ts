import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { FORMATS } from "@/lib/formats";
import { HIGHLIGHTABLE_EXTENSIONS } from "@/lib/languages";
import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

/** Distinct colours in the rendered code, ignoring the line-number gutter. */
async function paletteSize(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const colours = new Set<string>();
    for (const span of document.querySelectorAll(".code-block span[style]")) {
      const colour = getComputedStyle(span).color;
      if (colour) colours.add(colour);
    }
    return colours.size;
  });
}

test("every highlightable extension is one the app will open", () => {
  // The grammar map and the format registry are maintained separately, so a
  // language added to one and not the other would silently never highlight.
  const openable = new Set(FORMATS.flatMap((format) => format.extensions));
  const orphaned = HIGHLIGHTABLE_EXTENSIONS.filter(
    (extension) => !openable.has(extension),
  );
  expect(orphaned).toEqual([]);
});

test("SQL is highlighted", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("query.sql"));

  await expect(page.locator(".code-block")).toBeVisible();
  await expect(page.getByText("SELECT", { exact: false }).first()).toBeVisible();

  // A keyword, a string literal and a comment should not all render the same.
  expect(await paletteSize(page)).toBeGreaterThan(2);
});

test("TSX is highlighted", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("widget.tsx"));

  await expect(page.locator(".code-block")).toBeVisible();
  await expect(page.getByText("useState").first()).toBeVisible();
  expect(await paletteSize(page)).toBeGreaterThan(2);
});

test("line numbers survive highlighting", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("query.sql"));
  await expect(page.locator(".code-block")).toBeVisible();

  // Line numbers are a CSS counter on a pseudo-element. `content` computes to
  // the literal `counter(line)` rather than the resolved digit, so what's
  // checked is that the counter is wired and there is exactly one line element
  // per source line — the part that can actually regress.
  const state = await page.evaluate(() => {
    const lines = [...document.querySelectorAll(".code-block .line")];
    const first = lines[0]!;
    return {
      count: lines.length,
      increments: getComputedStyle(first, "::before").counterIncrement,
      gutterWidth: parseFloat(getComputedStyle(first, "::before").width),
    };
  });

  expect(state.count).toBe(5); // query.sql is five lines
  expect(state.increments).toContain("line");
  expect(state.gutterWidth).toBeGreaterThan(0);
});

test("a file with no grammar still opens, just uncoloured", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("server.log"));

  await expect(page.getByText("WARN slow query")).toBeVisible();
  await expect(page.locator("main [role=\"alert\"]")).toHaveCount(0);
  await expect(page.locator(".code-block")).toHaveCount(0);
});

test("highlighting does not execute markup in the source", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', {
    name: "evil.sql",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "-- <script>window.__pwned = true;</script>\nSELECT 1;\n",
    ),
  });

  await expect(page.locator(".code-block")).toBeVisible();
  // Shiki builds markup from parsed tokens, so source text is never markup.
  expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
});
