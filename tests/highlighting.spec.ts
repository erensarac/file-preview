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

  // The plain state renders through the same markup, so waiting on
  // `.code-block` would not wait for colour — a styled span is the signal.
  await expect(page.locator(".code-block span[style]").first()).toBeVisible();
  await expect(page.getByText("SELECT", { exact: false }).first()).toBeVisible();

  // A keyword, a string literal and a comment should not all render the same.
  expect(await paletteSize(page)).toBeGreaterThan(2);
});

test("TSX is highlighted", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("widget.tsx"));

  await expect(page.locator(".code-block span[style]").first()).toBeVisible();
  await expect(page.getByText("useState").first()).toBeVisible();
  expect(await paletteSize(page)).toBeGreaterThan(2);
});

test("line numbers survive highlighting", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("query.sql"));
  await expect(page.locator(".code-block span[style]").first()).toBeVisible();

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

test("gaining colour does not move the text", async ({ page }) => {
  /**
   * The reported bug: highlighting arrived a moment after the file opened and
   * the text visibly shifted and reindented, because the plain state and the
   * highlighted state were different layouts.
   *
   * The plain state is captured by blocking the highlighter chunks, so it
   * persists long enough to measure rather than depending on timing.
   */
  const positions = async (page: import("@playwright/test").Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll(".code-block .line")]
        .slice(0, 5)
        .map((line) => {
          const box = line.getBoundingClientRect();
          return { x: Math.round(box.x), y: Math.round(box.y) };
        }),
    );

  // Blocking has to happen *after* the app has loaded, and by URL pattern
  // alone: the chunks are content-hashed, so there is no "shiki" in their
  // names to match on. Everything requested from here is a lazy chunk.
  await page.goto("/");
  await page.route("**/*.js", (route) => route.abort());
  await page.setInputFiles('input[type="file"]', fixture("query.sql"));
  await expect(page.locator(".code-block .line").first()).toBeVisible();

  // Prove the plain state really is plain, or the comparison below is
  // colour-against-colour and passes without testing anything.
  await expect(page.locator(".code-block span[style]")).toHaveCount(0);
  const plain = await positions(page);
  expect(plain).toHaveLength(5);

  await page.unroute("**/*.js");
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("query.sql"));
  await expect(page.locator(".code-block span[style]").first()).toBeVisible();
  const coloured = await positions(page);

  expect(coloured).toEqual(plain);
});

test("a file with no grammar still opens, just uncoloured", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("server.log"));

  await expect(page.getByText("WARN slow query")).toBeVisible();
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  // It renders through the same structure, just without any coloured spans.
  await expect(page.locator(".code-block")).toBeVisible();
  await expect(page.locator(".code-block span[style]")).toHaveCount(0);
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

  await expect(page.locator(".code-block span[style]").first()).toBeVisible();
  // Shiki builds markup from parsed tokens, so source text is never markup.
  expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
});
