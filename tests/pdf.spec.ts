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

  await expect(page.getByTestId("pdf-page-count")).toHaveText("12 pages");
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
