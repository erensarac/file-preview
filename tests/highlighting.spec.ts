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

test.describe("Markdown code blocks", () => {
  /** Coloured tokens inside the nth `<pre>` of the rendered document. */
  const tokensIn = (page: import("@playwright/test").Page, index: number) =>
    page.locator(".rendered-doc pre").nth(index).locator("code span[style]");

  /**
   * Distinct rendered colours in a block. Counting spans would not do: a
   * grammar that tokenised but resolved every token to the same colour would
   * pass that while looking exactly like plain text.
   */
  const coloursIn = (page: import("@playwright/test").Page, index: number) =>
    page.locator(".rendered-doc pre").nth(index).evaluate((pre) => {
      const spans = [...pre.querySelectorAll("code span[style]")];
      return new Set(spans.map((span) => getComputedStyle(span).color)).size;
    });

  test("fences are highlighted, whatever the language is called", async ({
    page,
  }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("guide.md"));
    // Exact, or it also matches the "guide.md" filename in the pane header.
    await expect(
      page.getByRole("heading", { name: "Guide", exact: true }),
    ).toBeVisible();

    // `ts` is spelled like an extension, `sql` like a grammar id — both resolve.
    await expect(tokensIn(page, 0).first()).toBeVisible();
    await expect(tokensIn(page, 1).first()).toBeVisible();

    // TypeScript separates keyword, identifier, type and string; SQL at least
    // separates its keywords from everything else.
    expect(await coloursIn(page, 0)).toBeGreaterThanOrEqual(3);
    expect(await coloursIn(page, 1)).toBeGreaterThanOrEqual(2);
  });

  test("unknown and opted-out fences are left alone", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("guide.md"));
    await expect(tokensIn(page, 0).first()).toBeVisible();

    // Third block names a language nothing has a grammar for; fourth says
    // `text`, which is an explicit request not to colour it.
    await expect(page.getByText("this should stay plain")).toBeVisible();
    await expect(page.getByText("so should this")).toBeVisible();
    await expect(tokensIn(page, 2)).toHaveCount(0);
    await expect(tokensIn(page, 3)).toHaveCount(0);
  });

  test("a block does not move when its colour arrives", async ({ page }) => {
    /**
     * Measures, and refuses to return a measurement of nothing.
     *
     * `getBoundingClientRect` on a **detached** node answers all zeros, and a
     * node can be detached between the visibility check and the evaluate call
     * by a re-render that has nothing to do with this test. That happened on
     * CI: the baseline came back `{0, 0, 0, 0}`, became the expected value,
     * and the real geometry was reported as the mismatch — a test failing
     * while pointing at the wrong half of itself.
     *
     * Polling both fixes the race and turns "we failed to measure" into its
     * own failure rather than a silent zero.
     */
    const boxOf = async (page: import("@playwright/test").Page) => {
      let box = { x: 0, y: 0, width: 0, height: 0 };
      await expect
        .poll(
          async () => {
            box = await page
              .locator(".rendered-doc pre")
              .first()
              .evaluate((element) => {
                const rect = element.getBoundingClientRect();
                return {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                };
              });
            return box.width * box.height;
          },
          { message: "the code block never reported a size" },
        )
        .toBeGreaterThan(0);
      return box;
    };

    await page.goto("/");

    // Open a fence-free document first. That loads the Markdown parser's own
    // lazy chunks into the module cache, so the block below can stop the
    // highlighter without also stopping the render — blocking everything from
    // the start leaves nothing on screen to measure.
    await page.setInputFiles('input[type="file"]', fixture("notes.md"));
    await expect(
      page.getByRole("heading", { name: "Release notes" }),
    ).toBeVisible();

    await page.route("**/*.js", (route) => route.abort());
    await page.setInputFiles('input[type="file"]', fixture("guide.md"));
    await expect(page.locator(".rendered-doc pre").first()).toBeVisible();
    await expect(tokensIn(page, 0)).toHaveCount(0);
    const plain = await boxOf(page);

    await page.unroute("**/*.js");
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("guide.md"));
    await expect(tokensIn(page, 0).first()).toBeVisible();

    // Only the contents of `<code>` are replaced, so the `<pre>` Markdown
    // produced keeps its exact geometry.
    expect(await boxOf(page)).toEqual(plain);
  });

  test("Word documents never load the highlighter", async ({ page }) => {
    await page.goto("/");
    const afterLoad: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith(".js")) afterLoad.push(request.url());
    });

    await page.setInputFiles('input[type="file"]', fixture("summary.docx"));
    await expect(
      page.getByRole("heading", { name: "Quarterly Summary" }),
    ).toBeVisible();
    await page.waitForTimeout(500);

    // Word HTML has no fenced blocks, so the highlighter should never be
    // fetched — the pass has to bail out before importing it.
    expect(afterLoad).toEqual([]);
  });
});
