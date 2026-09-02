import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

/**
 * A phone-sized viewport.
 *
 * Nothing in the product was designed below a desktop width until this suite
 * existed: the two scroll regions that had a height cap used a fixed `70vh`,
 * the other two had none at all, and a phone is the likeliest place for the
 * problem this site exists to solve — someone is sent a file and has nothing
 * that opens it.
 *
 * 390x844 is the iPhone 12/13/14 logical viewport, the most common phone size
 * in use.
 */
const PHONE = { width: 390, height: 844 };

async function open(page: Page, name: string) {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture(name));
}

test.describe("on a phone-sized viewport", () => {
  test.use({ viewport: PHONE });

  /**
   * A page that scrolls sideways is the classic symptom of a desktop layout
   * dropped onto a phone. Inner scrollers are exempt on purpose — a wide table
   * or a long code line is *supposed* to scroll within its own box; it is the
   * document element that must not.
   */
  for (const [label, file, ready] of [
    ["a CSV", "sales.csv", "Marmara"],
    ["a spreadsheet", "report.xlsx", "February"],
    ["a document", "toc.md", "Şubat Özeti"],
    ["source code", "widget.tsx", "useState"],
  ] as const) {
    test(`${label} does not make the page scroll sideways`, async ({
      page,
    }) => {
      await open(page, file);
      await expect(page.getByText(ready).first()).toBeVisible();

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }

  /**
   * Chrome above the document used to take 328px of an 844px screen — 39% of
   * the phone spent on a title, a paragraph and a drop target, before any of
   * the file the user came to read.
   *
   * The threshold guards against that creeping back rather than pinning the
   * current number, which is around 244.
   */
  test("the file starts within the first half of the screen", async ({
    page,
  }) => {
    await open(page, "report.xlsx");
    await expect(page.getByText("February")).toBeVisible();

    const pane = (await page.locator("main section").boundingBox())!;
    expect(pane.y).toBeLessThan(PHONE.height * 0.4);
  });

  /**
   * The text and document viewers had no height cap at all, so a long file
   * grew the pane past the viewport and the page scrolled — taking the header
   * naming the file off the top of the screen, on the one device where
   * scrolling back up costs the most.
   */
  test("a long document scrolls inside the pane, not the page", async ({
    page,
  }) => {
    await open(page, "toc.md");
    await expect(page.getByRole("heading", { name: "Contents" })).toBeVisible();

    const region = page.getByRole("region", { name: "Document" });
    await region.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => region.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    // The filename header is what tells you which file you are looking at.
    await expect(page.getByText("toc.md")).toBeInViewport();
  });

  /**
   * A phone is narrower than an A4 page at 100%, so the default zoom left the
   * page cut off at the right edge with nothing to say the rest of it was
   * reachable by scrolling sideways.
   */
  test.describe("PDF", () => {
    test("a page is fitted to the screen rather than cut off", async ({
      page,
    }) => {
      await open(page, "report.pdf");
      await expect(
        page.locator('[data-testid="pdf-page-1"][data-rendered="true"]'),
      ).toBeVisible({ timeout: 30_000 });

      const region = page.getByRole("region", { name: /Document pages/ });
      const available = await region.evaluate(
        (element) => (element as HTMLElement).clientWidth,
      );
      const pageWidth = (await page
        .getByTestId("pdf-page-1")
        .boundingBox())!.width;

      expect(pageWidth).toBeLessThanOrEqual(available);
      // Fitting an A4 page into 390px means shrinking it, so the readout has
      // to have moved off the 100% it would otherwise show.
      await expect(page.getByText("%")).not.toHaveText("100%");
    });

    test("Fit returns to the fitted zoom after zooming in", async ({
      page,
    }) => {
      await open(page, "report.pdf");
      await expect(
        page.locator('[data-testid="pdf-page-1"][data-rendered="true"]'),
      ).toBeVisible({ timeout: 30_000 });

      const fit = page.getByRole("button", { name: "Fit page width" });
      await expect(fit).toHaveAttribute("aria-pressed", "true");
      const fitted = (await page.getByTestId("pdf-page-1").boundingBox())!.width;

      await page.getByRole("button", { name: "Zoom in" }).click();
      await expect(fit).toHaveAttribute("aria-pressed", "false");
      await expect
        .poll(
          async () => (await page.getByTestId("pdf-page-1").boundingBox())!.width,
        )
        .toBeGreaterThan(fitted);

      await fit.click();
      await expect(fit).toHaveAttribute("aria-pressed", "true");
      await expect
        .poll(
          async () => (await page.getByTestId("pdf-page-1").boundingBox())!.width,
        )
        .toBeCloseTo(fitted, 0);
    });
  });

  /** The drag wording describes a gesture the device does not have. */
  test("the drop prompt names the tap instead of a drag", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Open a file")).toBeVisible();
    await expect(page.getByText("Drop a file here")).toBeHidden();
  });
});

test("on a desktop viewport the drop prompt still names the drag", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Drop a file here")).toBeVisible();
  await expect(page.getByText("Open a file")).toBeHidden();
});

/**
 * Touch, which is a separate axis from width: a narrow window on a laptop
 * still reports a fine pointer, and only `hasTouch` makes Chromium report
 * `pointer: coarse` — the query the handle rule is written against.
 */
test.describe("with a touch screen", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  /**
   * The resize handle is an 8px strip down the right edge of every column
   * header carrying `touch-action: none`. On a phone that meant any scroll
   * starting near a column border was swallowed and the table refused to
   * move — at a dozen places across its own header.
   */
  test("column resize handles do not swallow scrolling", async ({ page }) => {
    await open(page, "report.xlsx");
    await expect(page.locator("table td").first()).toBeVisible();

    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      "the emulation has to report a coarse pointer or this proves nothing",
    ).toBe(true);

    await expect(page.getByTestId("resize-0")).toHaveCSS(
      "pointer-events",
      "none",
    );
  });

  /**
   * Hiding it from the pointer must not take away the only other way to reach
   * it: a tablet has a touch screen and a keyboard.
   */
  test("but stay operable from a keyboard", async ({ page }) => {
    await open(page, "report.xlsx");
    await expect(page.locator("table td").first()).toBeVisible();

    const widthOf = () =>
      page
        .locator("thead th")
        .nth(1)
        .evaluate((cell) => cell.getBoundingClientRect().width);

    const handle = page.getByTestId("resize-0");
    await handle.focus();
    await expect(handle).toBeFocused();

    const before = await widthOf();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(await widthOf()).toBeGreaterThan(before);
  });
});

test("on a fine pointer the handles keep taking the mouse", async ({
  page,
}) => {
  await open(page, "report.xlsx");
  await expect(page.locator("table td").first()).toBeVisible();

  await expect(page.getByTestId("resize-0")).toHaveCSS("pointer-events", "auto");
});
