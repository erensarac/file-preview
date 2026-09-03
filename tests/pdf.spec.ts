import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

/** A page is only considered rendered once its canvas has actually painted. */
const rendered = (page: Page, pageNumber: number) =>
  page.locator(`[data-testid="pdf-page-${pageNumber}"][data-rendered="true"]`);

async function openPdf(page: Page, name = "report.pdf") {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture(name));
}

test("renders the first page and reports the page count", async ({ page }) => {
  await openPdf(page);

  // The count now sits beside the box you type a page number into.
  await expect(page.getByTestId("pdf-page-count")).toHaveText("of 12");
  await expect(page.getByTestId("pdf-page-input")).toHaveValue("1");
  await expect(rendered(page, 1)).toBeVisible();
  // A canvas with content, not an empty element sized like one.
  const painted = await page
    .locator('[data-testid="pdf-page-1"] canvas')
    .evaluate((canvas) => {
      const element = canvas as HTMLCanvasElement;
      const context = element.getContext("2d")!;
      const { data } = context.getImageData(0, 0, element.width, element.height);
      // Any non-white pixel means something was drawn.
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) {
          return true;
        }
      }
      return false;
    });
  expect(painted, "the page canvas should have ink on it").toBe(true);
});

test("a PDF is never uploaded", async ({ page }) => {
  await page.goto("/");
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });

  await page.setInputFiles('input[type="file"]', fixture("report.pdf"));
  await expect(rendered(page, 1)).toBeVisible();
  await expect(page.getByText("read locally")).toBeVisible();

  expect(posts, "PDFs are a client format and must stay local").toEqual([]);
});

test("far pages are not rendered until scrolled to", async ({ page }) => {
  await openPdf(page);
  await expect(rendered(page, 1)).toBeVisible();

  // Holding every page as a bitmap is what this avoids, so a page far down the
  // document must start out unrendered.
  await expect(
    page.locator('[data-testid="pdf-page-12"][data-rendered="false"]'),
  ).toHaveCount(1);

  await page
    .locator('[data-testid="pdf-page-1"]')
    .evaluate((element) =>
      element.closest(".viewer-scroller")!.scrollTo({ top: 100_000 }),
    );

  await expect(rendered(page, 12)).toBeVisible();
});

test("zooming changes the rendered size", async ({ page }) => {
  await openPdf(page);
  await expect(rendered(page, 1)).toBeVisible();

  const widthOf = () =>
    page
      .locator('[data-testid="pdf-page-1"]')
      .evaluate((element) => element.getBoundingClientRect().width);

  const before = await widthOf();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByText("125%")).toBeVisible();
  expect(await widthOf()).toBeGreaterThan(before);
});

test("a file that is not a PDF is refused on its signature", async ({
  page,
}) => {
  await openPdf(page, "not-really.pdf");

  await expect(page.locator('main [role="alert"]')).toContainText(
    "doesn't look like a PDF",
  );
  await expect(page.locator("canvas")).toHaveCount(0);
});

test.describe("the text layer", () => {
  test("page text is real text, not just a picture", async ({ page }) => {
    await openPdf(page);
    await expect(rendered(page, 1)).toBeVisible();

    // The words are in the DOM, which is what makes selection, copying, the
    // browser's own find, and screen readers work at all.
    await expect(page.getByTestId("pdf-text-1")).toContainText("Page 1 of 12");
  });

  test("text sits over the glyphs it belongs to", async ({ page }) => {
    await openPdf(page);
    await expect(rendered(page, 1)).toBeVisible();

    const overlap = async () =>
      page.evaluate(() => {
        const layer = document.querySelector('[data-testid="pdf-text-1"]');
        const span = layer?.querySelector("span");
        const canvas = document.querySelector(
          '[data-testid="pdf-page-1"] canvas',
        );
        if (!span || !canvas) return null;

        const text = span.getBoundingClientRect();
        const page = canvas.getBoundingClientRect();
        return {
          // Where the text run sits on the page, as a fraction of its size.
          x: (text.left - page.left) / page.width,
          y: (text.top - page.top) / page.height,
        };
      });

    const before = await overlap();
    expect(before).not.toBeNull();

    // Zooming rebuilds the layer at the new scale. Using the canvas's own
    // scale here instead of the CSS one would put the spans at a fraction of
    // the glyphs, which is invisible until someone tries to select.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByText("125%")).toBeVisible();
    await expect(page.getByTestId("pdf-text-1")).toContainText("Page 1 of 12");

    const after = await overlap();
    expect(after!.x).toBeCloseTo(before!.x, 2);
    expect(after!.y).toBeCloseTo(before!.y, 2);
  });

  test("only rendered pages carry a text layer", async ({ page }) => {
    await openPdf(page);
    await expect(rendered(page, 1)).toBeVisible();

    // Same rule as the canvases: a hundred-page document should not hold a
    // hundred layers to show one screen.
    await expect(page.getByTestId("pdf-text-12")).toHaveCount(0);
  });
});

/**
 * Pages of different sizes in one document.
 *
 * Every page used to be assumed to be the size of page 1, while its canvas was
 * rasterised from its own viewport — so a landscape page was drawn landscape
 * and displayed in a portrait box, squashed. Nothing errored; it just looked
 * like a bad export of the file.
 */
test.describe("a document with mixed page sizes", () => {
  const boxOf = (page: Page, pageNumber: number) =>
    page
      .getByTestId(`pdf-page-${pageNumber}`)
      .evaluate((element) => {
        const box = element.getBoundingClientRect();
        const canvas = element.querySelector("canvas");
        const painted = canvas?.getBoundingClientRect();
        return {
          width: Math.round(box.width),
          height: Math.round(box.height),
          canvasWidth: painted ? Math.round(painted.width) : null,
          canvasHeight: painted ? Math.round(painted.height) : null,
        };
      });

  test("a landscape page keeps its own shape", async ({ page }) => {
    await openPdf(page, "mixed-sizes.pdf");
    await expect(rendered(page, 2)).toBeVisible({ timeout: 30_000 });

    const portrait = await boxOf(page, 1);
    const landscape = await boxOf(page, 2);

    expect(portrait.height).toBeGreaterThan(portrait.width);
    // The whole bug in one assertion: this used to be a portrait box.
    expect(landscape.width).toBeGreaterThan(landscape.height);

    // And the box has to match the bitmap inside it, or the page is stretched
    // rather than merely mis-sized.
    expect(landscape.canvasWidth).toBe(landscape.width);
    expect(landscape.canvasHeight).toBe(landscape.height);
  });

  test("its text layer still sits over its glyphs", async ({ page }) => {
    await openPdf(page, "mixed-sizes.pdf");
    await expect(rendered(page, 2)).toBeVisible({ timeout: 30_000 });

    // The layer is positioned from the real page while its container was
    // sized from page 1, so on this page the two disagreed.
    const span = page.getByTestId("pdf-text-2").locator("span").first();
    await expect(span).toHaveText(/Landscape two/);

    const drift = await page
      .getByTestId("pdf-page-2")
      .evaluate((element) => {
        const layer = element.querySelector('[data-testid="pdf-text-2"] span');
        const page2 = element.getBoundingClientRect();
        const text = layer!.getBoundingClientRect();
        return {
          fromLeft: text.left - page2.left,
          fromTop: text.top - page2.top,
          within: text.right <= page2.right + 1,
        };
      });

    // The content stream puts the text 60pt in and 102pt down.
    expect(drift.fromLeft).toBeGreaterThan(40);
    expect(drift.fromLeft).toBeLessThan(90);
    expect(drift.fromTop).toBeGreaterThan(50);
    expect(drift.fromTop).toBeLessThan(130);
    expect(drift.within, "the text layer overflows its page").toBe(true);
  });

  test("scrolling lands on the right page", async ({ page }) => {
    await openPdf(page, "mixed-sizes.pdf");
    await expect(rendered(page, 1)).toBeVisible({ timeout: 30_000 });

    // Page 3 sits below a portrait and a landscape page. Working out where it
    // starts by multiplying one page height gets this wrong.
    await page.getByTestId("pdf-page-input").fill("3");
    await page.getByTestId("pdf-page-input").press("Enter");

    await expect(rendered(page, 3)).toBeVisible();
    await expect.poll(() => page.getByTestId("pdf-page-input").inputValue()).toBe("3");
  });
});

/**
 * Reaching a page without dragging. In a long document the scrollbar is the
 * only way there, and it is a poor one.
 */
test.describe("going to a page", () => {
  test("typing a number scrolls to it", async ({ page }) => {
    await openPdf(page);
    await expect(rendered(page, 1)).toBeVisible();

    await page.getByTestId("pdf-page-input").fill("9");
    await page.getByTestId("pdf-page-input").press("Enter");

    await expect(rendered(page, 9)).toBeVisible();
    // Landed at the top of page 9 rather than merely somewhere near it.
    const offset = await page
      .getByTestId("pdf-page-9")
      .evaluate((element) => {
        const scroller = element.closest(".viewer-scroller")!;
        return (
          element.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top
        );
      });
    expect(Math.abs(offset)).toBeLessThan(20);
  });

  test("the box follows the scroll", async ({ page }) => {
    await openPdf(page);
    await expect(rendered(page, 1)).toBeVisible();
    await expect(page.getByTestId("pdf-page-input")).toHaveValue("1");

    await page
      .getByTestId("pdf-page-1")
      .evaluate((element) =>
        element.closest(".viewer-scroller")!.scrollTo({ top: 100_000 }),
      );

    // Whatever the last page turns out to be, the box must not still say 1.
    await expect
      .poll(() => page.getByTestId("pdf-page-input").inputValue())
      .not.toBe("1");
  });

  test("a number outside the document is clamped, not obeyed", async ({
    page,
  }) => {
    await openPdf(page);
    await expect(rendered(page, 1)).toBeVisible();

    await page.getByTestId("pdf-page-input").fill("999");
    await page.getByTestId("pdf-page-input").press("Enter");

    await expect(page.getByTestId("pdf-page-input")).toHaveValue("12");
    await expect(rendered(page, 12)).toBeVisible();
  });
});
