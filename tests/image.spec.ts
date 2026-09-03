import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

async function open(page: Page, name: string) {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture(name));
}

const preview = (page: Page) => page.getByTestId("image-preview");

test("a PNG opens and reports its size", async ({ page }) => {
  await open(page, "picture.png");

  await expect(preview(page)).toBeVisible();
  // From the fixture, which builds a 200x120 image — a rectangle rather than
  // a square, so a transposed width and height cannot pass.
  await expect(page.getByTestId("image-dimensions")).toHaveText("200 × 120");

  const decoded = await preview(page).evaluate((element) => {
    const image = element as HTMLImageElement;
    return { complete: image.complete, width: image.naturalWidth };
  });
  expect(decoded.complete, "the browser never finished decoding it").toBe(true);
  expect(decoded.width).toBe(200);
});

test("an image is never uploaded", async ({ page }) => {
  await page.goto("/");
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });

  await page.setInputFiles('input[type="file"]', fixture("picture.png"));
  await expect(preview(page)).toBeVisible();
  await expect(page.getByText("read locally")).toBeVisible();

  expect(posts, "images are decoded by the browser and must stay local")
    .toEqual([]);
});

/**
 * The blob URL has one owner, and it has to release it.
 *
 * The pane is remounted per opened file, so a URL left behind survives for the
 * life of the tab along with the bytes it points at — a leak that is invisible
 * until someone opens twenty photographs.
 */
test("the blob URL is released when another file is opened", async ({
  page,
}) => {
  await open(page, "picture.png");
  await expect(preview(page)).toBeVisible();

  const url = await preview(page).getAttribute("src");
  expect(url).toMatch(/^blob:/);

  await page.setInputFiles('input[type="file"]', fixture("sales.csv"));
  await expect(page.getByText("Marmara")).toBeVisible();

  // A revoked blob URL cannot be fetched. If this resolves, the bytes are
  // still being held.
  const stillThere = await page.evaluate(async (blobUrl) => {
    try {
      await fetch(blobUrl!);
      return true;
    } catch {
      return false;
    }
  }, url);
  expect(stillThere, "the blob URL still resolves, so it was never revoked")
    .toBe(false);
});

test.describe("zoom", () => {
  test("matches the PDF viewer's controls", async ({ page }) => {
    await open(page, "picture.png");
    await expect(preview(page)).toBeVisible();

    // A 200px image inside a desktop pane fits without shrinking, because
    // fitting never magnifies.
    await expect(page.getByText("100%")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Fit image width" }),
    ).toHaveAttribute("aria-pressed", "true");

    const before = (await preview(page).boundingBox())!.width;
    await page.getByRole("button", { name: "Zoom in" }).click();

    await expect(page.getByText("125%")).toBeVisible();
    await expect
      .poll(async () => (await preview(page).boundingBox())!.width)
      .toBeGreaterThan(before);
    await expect(
      page.getByRole("button", { name: "Fit image width" }),
    ).toHaveAttribute("aria-pressed", "false");

    await page.getByRole("button", { name: "Fit image width" }).click();
    await expect
      .poll(async () => (await preview(page).boundingBox())!.width)
      .toBeCloseTo(before, 0);
  });

  test("an image wider than the pane is fitted, not cut off", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "picture.png");
    await expect(preview(page)).toBeVisible();

    const region = page.getByRole("region", { name: "Image" });
    const available = await region.evaluate(
      (element) => (element as HTMLElement).clientWidth,
    );
    const shown = (await preview(page).boundingBox())!.width;

    expect(shown).toBeLessThanOrEqual(available);
  });
});

/**
 * An SVG is a document, not a picture: it can carry script and reference
 * remote resources. It is an accepted format here only because the viewer
 * loads it through an `<img>`, where the browser renders it in secure static
 * mode. This is the spec that says so.
 */
test.describe("SVG", () => {
  test("renders without running what is inside it", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      // Only real network requests count. The viewer's own `blob:` URL is how
      // the image is handed to the browser at all, and reads no differently
      // from a remote fetch unless it is excluded here — which is what this
      // assertion caught the first time it ran.
      if (/^https?:/.test(url) && !url.startsWith("http://127.0.0.1")) {
        external.push(url);
      }
    });

    await open(page, "diagram.svg");
    await expect(preview(page)).toBeVisible();
    await expect(page.getByTestId("image-dimensions")).toHaveText("160 × 90");

    // The fixture's script sets this. Secure static mode means it never runs.
    expect(
      await page.evaluate(() => "__svgPwned" in window),
      "the SVG's script executed",
    ).toBe(false);

    // And its remote <image href> must not have been fetched either, or an
    // opened file could report back to whoever sent it.
    expect(external, "the SVG reached the network").toEqual([]);
  });
});

test("a file that is not really an image says so", async ({ page }) => {
  await open(page, "not-really.png");

  // There is no signature check for images — the browser failing to decode is
  // the check, and this is the message it produces.
  await expect(page.locator('main [role="alert"]')).toContainText(
    "couldn't be decoded",
  );
});
