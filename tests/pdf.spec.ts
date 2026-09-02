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
      element.closest(".overflow-auto")!.scrollTo({ top: 100_000 }),
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
