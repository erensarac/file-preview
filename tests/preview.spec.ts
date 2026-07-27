import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

/** The error banner, scoped to the page — Next renders its own `role="alert"`. */
const errorBanner = (page: Page) => page.locator('main [role="alert"]');

async function open(page: Page, name: string) {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture(name));
}

test.describe("format rendering", () => {
  test("CSV keeps a quoted delimiter inside one cell", async ({ page }) => {
    await open(page, "sales.csv");
    await expect(page.getByText("Marmara")).toBeVisible();
    // The comma inside the quotes must not have split the field.
    await expect(page.getByText("Ali, Jr.")).toBeVisible();
    await expect(errorBanner(page)).toHaveCount(0);
  });

  test("Markdown renders structure", async ({ page }) => {
    await open(page, "notes.md");
    await expect(
      page.getByRole("heading", { name: "Release notes" }),
    ).toBeVisible();
    await expect(page.getByText("second item")).toBeVisible();
  });

  test("JSON is pretty-printed", async ({ page }) => {
    await open(page, "config.json");
    await expect(page.getByText('"nested"')).toBeVisible();
  });

  test("Excel resolves formulas and exposes every sheet", async ({ page }) => {
    await open(page, "report.xlsx");
    await expect(page.getByText("February")).toBeVisible();
    // The formula cell shows its cached result, not `SUM(B2:B3)`.
    await expect(page.getByText("96200")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Notes" })).toBeVisible();
  });

  test("Word converts text, accents intact", async ({ page }) => {
    await open(page, "summary.docx");
    await expect(
      page.getByRole("heading", { name: "Quarterly Summary" }),
    ).toBeVisible();
    await expect(page.getByText("şığüöç")).toBeVisible();
  });

  test("dotfiles are matched on the name after the leading dot", async ({
    page,
  }) => {
    await open(page, ".env");
    await expect(page.getByText("TOKEN=not-a-real-secret")).toBeVisible();
    await expect(errorBanner(page)).toHaveCount(0);
  });
});

test.describe("the privacy split", () => {
  /**
   * The product's central claim. If someone flips a `runtime` in
   * `lib/formats.ts`, a text file starts being uploaded and nothing else in the
   * suite would notice.
   */
  test("client formats generate no network traffic", async ({ page }) => {
    await page.goto("/");
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });

    await page.setInputFiles('input[type="file"]', fixture("sales.csv"));
    await expect(page.getByText("Marmara")).toBeVisible();
    await expect(page.getByText("read locally")).toBeVisible();

    expect(posts, "a client-parsed file must never be uploaded").toEqual([]);
  });

  test("server formats go through exactly one server action call", async ({
    page,
  }) => {
    await page.goto("/");
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });

    await page.setInputFiles('input[type="file"]', fixture("report.xlsx"));
    await expect(page.getByText("February")).toBeVisible();
    await expect(page.getByText("converted on server")).toBeVisible();

    expect(posts).toHaveLength(1);
  });
});

test("markdown cannot execute smuggled script tags", async ({ page }) => {
  await open(page, "notes.md");
  await expect(
    page.getByRole("heading", { name: "Release notes" }),
  ).toBeVisible();

  const executed = await page.evaluate(() => "__pwned" in window);
  expect(executed, "DOMPurify should have stripped the inline script").toBe(
    false,
  );
});

test("unsupported formats fail with a readable message", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', {
    name: "photo.heic",
    mimeType: "image/heic",
    buffer: Buffer.from([1, 2, 3]),
  });
  await expect(errorBanner(page)).toContainText("can't open");
});

test("an oversized upload is refused without being sent", async ({ page }) => {
  await page.goto("/");
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });

  // Above the 4 MB server-format cap. The platform rejects bodies past its own
  // limit before any of our code runs, so the only way the user sees our
  // message is if the upload never leaves the browser.
  await page.setInputFiles('input[type="file"]', {
    name: "huge.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.alloc(5 * 1024 * 1024),
  });

  await expect(errorBanner(page)).toContainText("limited to 4.0 MB");
  expect(posts, "an oversized file must not be uploaded at all").toEqual([]);
});

test("a failed open clears the previous preview", async ({ page }) => {
  await open(page, "sales.csv");
  await expect(page.getByText("Marmara")).toBeVisible();

  await page.setInputFiles('input[type="file"]', {
    name: "photo.heic",
    mimeType: "image/heic",
    buffer: Buffer.from([1, 2, 3]),
  });

  await expect(errorBanner(page)).toBeVisible();
  // The stale document must be gone; otherwise the error sits above a header
  // naming a different file.
  await expect(page.getByText("sales.csv")).toHaveCount(0);
});

test("sheet selection resets when a new file is opened", async ({ page }) => {
  await open(page, "report.xlsx");
  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(page.getByRole("tab", { name: "Notes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.setInputFiles('input[type="file"]', fixture("report.xlsx"));
  await expect(page.getByText("February")).toBeVisible();

  await expect(page.getByRole("tab", { name: "Q1" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test.describe("column widths", () => {
  const widthOf = (page: Page, column: number) =>
    page
      .locator("thead th")
      .nth(column + 1) // +1 for the row-number gutter
      .evaluate((cell) => cell.getBoundingClientRect().width);

  test("stay fixed while scrolling", async ({ page }) => {
    await open(page, "wide.xlsx");
    // 3 MB uploaded, parsed and rendered — comfortably past the default
    // 5s expect timeout when the suite runs its workers in parallel.
    await expect(page.locator("table td").first()).toBeVisible({
      timeout: 30_000,
    });

    const before = await Promise.all([0, 1, 2].map((c) => widthOf(page, c)));

    // The viewer only mounts the rows in view, so an auto-layout table would
    // resize its columns as scrolling swapped the mounted content.
    await page
      .locator("table")
      .locator("..")
      .evaluate((element) => {
        element.scrollTop = 300 * 33;
      });
    await expect(page.getByText("r300c0")).toBeVisible();

    const after = await Promise.all([0, 1, 2].map((c) => widthOf(page, c)));
    expect(after).toEqual(before);
  });

  test("resize by dragging the header edge", async ({ page }) => {
    await open(page, "report.xlsx");
    await expect(page.locator("table td").first()).toBeVisible();

    const before = await widthOf(page, 0);
    const handle = page.getByTestId("resize-0");
    const box = (await handle.boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, {
      steps: 8,
    });
    await page.mouse.up();

    expect(await widthOf(page, 0)).toBeGreaterThan(before + 100);
    // Neighbours are unaffected — only the dragged column changes.
    await expect(page.getByText("Revenue")).toBeVisible();
  });

  test("double-clicking the edge fits the column to its widest value", async ({
    page,
  }) => {
    await open(page, "report.xlsx");
    await expect(page.locator("table td").first()).toBeVisible();

    const fitted = await widthOf(page, 0);

    // Shrink it well below the content, then ask for the fit back.
    const handle = page.getByTestId("resize-0");
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    expect(await widthOf(page, 0)).toBeLessThan(fitted);

    await page.getByTestId("resize-0").dblclick();
    expect(await widthOf(page, 0)).toBeCloseTo(fitted, 0);
  });
});

test("a sheet at the preview caps stays responsive", async ({ page }) => {
  await open(page, "wide.xlsx");
  // As above: the 3 MB fixture needs more than the default expect timeout.
  await expect(page.locator("table td").first()).toBeVisible({
    timeout: 30_000,
  });

  // Rendering every cell of a capped sheet would be ~400k nodes and roughly
  // 30s to paint; only the visible window may be mounted.
  const cells = await page.locator("table td").count();
  expect(cells).toBeLessThan(20_000);

  // 220 columns exceeds the column cap, and the cell budget then bounds the
  // rows — both are disclosed rather than silently applied.
  await expect(page.getByText(/showing the first 200/)).toBeVisible();
  await expect(page.getByText(/truncated at 100,000 cells/)).toBeVisible();

  // The mounted window has to follow the scroll. Row 400 is inside the budget
  // (100,000 cells ÷ 200 columns = 500 rows) and far outside the first screen.
  await page
    .locator("table")
    .locator("..")
    .evaluate((element) => {
      element.scrollTop = 400 * 33;
    });
  await expect(page.getByText("r400c0")).toBeVisible();
});
