import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

/**
 * Runs axe against the whole page and returns the violations.
 *
 * Scoped to WCAG A and AA: those are the rules with an agreed meaning, and
 * failing the build on best-practice rules would make the suite a matter of
 * taste rather than a check.
 */
async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

/**
 * Both schemes are audited, because contrast is the rule most likely to differ
 * between them — the first run of this suite found the primary button at
 * 2.66:1 in dark mode while passing in light.
 */
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`no accessibility violations (${colorScheme})`, () => {
    test.use({ colorScheme });
  test("on the empty page", async ({ page }) => {
    await page.goto("/");
    expect(await violations(page)).toEqual([]);
  });

  test("with a spreadsheet open", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("report.xlsx"));
    await expect(page.getByText("February")).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test("with a document open", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("guide.md"));
    await expect(
      page.getByRole("heading", { name: "Guide", exact: true }),
    ).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test("with source code open", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("query.sql"));
    await expect(page.locator(".code-block span[style]").first()).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test("with a PDF open", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("report.pdf"));
    await expect(
      page.locator('[data-testid="pdf-page-1"][data-rendered="true"]'),
    ).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test("with an error showing", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', {
      name: "photo.heic",
      mimeType: "image/heic",
      buffer: Buffer.from([1, 2, 3]),
    });
    await expect(page.locator('main [role="alert"]')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
  });
}

/**
 * Keyboard reachability, which an automated audit cannot judge: axe sees the
 * roles and names, not whether the controls can actually be operated.
 */
test.describe("keyboard operation", () => {
  test("sheets can be changed with the arrow keys", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("report.xlsx"));
    await expect(page.getByRole("tab", { name: "Q1" })).toBeVisible();

    await page.getByRole("tab", { name: "Q1" }).focus();
    await page.keyboard.press("ArrowRight");

    await expect(page.getByRole("tab", { name: "Notes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("Second sheet works")).toBeVisible();

    // Home returns to the first sheet, and the strip is a single tab stop:
    // the unselected tabs are skipped rather than being separate stops.
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "Q1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Notes" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  test("columns can be resized without a mouse", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("report.xlsx"));
    await expect(page.locator("table td").first()).toBeVisible();

    const widthOf = () =>
      page
        .locator("thead th")
        .nth(1)
        .evaluate((cell) => cell.getBoundingClientRect().width);

    const handle = page.getByTestId("resize-0");
    await handle.focus();
    const before = await widthOf();

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(await widthOf()).toBeGreaterThan(before);

    // Enter does what double-clicking does.
    await page.keyboard.press("Enter");
    expect(await widthOf()).toBeCloseTo(before, 0);
  });

  test("scroll regions can be reached and scrolled", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("wide.xlsx"));
    await expect(page.locator("table td").first()).toBeVisible({
      timeout: 30_000,
    });

    const panel = page.getByRole("region", { name: /Wide/ });
    await panel.focus();
    await expect(panel).toBeFocused();

    const before = await panel.evaluate((element) => element.scrollTop);
    await page.keyboard.press("PageDown");
    expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      before,
    );
  });
});
