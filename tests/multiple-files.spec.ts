import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

/** The file strip, which only exists when there is a choice to make. */
const strip = (page: Page) => page.getByRole("tablist", { name: "Dropped files" });

async function openAll(page: Page, ...names: string[]) {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', names.map(fixture));
}

test.describe("several files at once", () => {
  test("all of them are offered, and the first opens", async ({ page }) => {
    await openAll(page, "sales.csv", "notes.md", "config.json");

    await expect(strip(page).getByRole("tab")).toHaveCount(3);
    await expect(strip(page).getByRole("tab")).toHaveText([
      "sales.csv",
      "notes.md",
      "config.json",
    ]);

    // Previously the other two were discarded with nothing said about them.
    await expect(page.getByText("Marmara")).toBeVisible();
    await expect(strip(page).getByRole("tab").first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("choosing another one opens it", async ({ page }) => {
    await openAll(page, "sales.csv", "notes.md", "config.json");
    await expect(page.getByText("Marmara")).toBeVisible();

    await strip(page).getByRole("tab", { name: "notes.md" }).click();

    await expect(
      page.getByRole("heading", { name: "Release notes" }),
    ).toBeVisible();
    await expect(page.getByText("Marmara")).toHaveCount(0);
  });

  /**
   * The strip is one tab stop with arrows inside, like the sheet tabs. Twenty
   * separate stops between the drop zone and the document would make a
   * keyboard user pay for the feature every time they pass it.
   */
  test("the strip is one tab stop, with arrows inside", async ({ page }) => {
    await openAll(page, "sales.csv", "notes.md", "config.json");
    await expect(page.getByText("Marmara")).toBeVisible();

    const tabs = strip(page).getByRole("tab");
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");

    await expect(
      page.getByRole("heading", { name: "Release notes" }),
    ).toBeVisible();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    // The unselected ones are skipped by Tab rather than being stops of
    // their own.
    await expect(tabs.first()).toHaveAttribute("tabindex", "-1");

    await page.keyboard.press("End");
    await expect(page.getByText('"nested"')).toBeVisible();
  });

  test("a single file shows no strip at all", async ({ page }) => {
    await openAll(page, "sales.csv");
    await expect(page.getByText("Marmara")).toBeVisible();
    await expect(strip(page)).toHaveCount(0);
  });

  /**
   * The whole point of parsing only the selected file. Dropping three
   * spreadsheets should not upload three spreadsheets to look at one.
   */
  test("only the file being looked at is uploaded", async ({ page }) => {
    await page.goto("/");
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });

    await page.setInputFiles('input[type="file"]', [
      fixture("report.xlsx"),
      fixture("summary.docx"),
      fixture("sales.csv"),
    ]);
    await expect(page.getByText("February")).toBeVisible();

    expect(posts, "only the open file may be sent").toHaveLength(1);

    // And selecting the CSV adds nothing, because it is read locally.
    await strip(page).getByRole("tab", { name: "sales.csv" }).click();
    await expect(page.getByText("Marmara")).toBeVisible();
    expect(posts).toHaveLength(1);
  });

  test("one bad file does not take the others with it", async ({ page }) => {
    await page.goto("/");
    // Playwright refuses to mix paths with buffers in one call, so all three
    // are built here rather than two of them coming from the fixture set.
    await page.setInputFiles('input[type="file"]', [
      {
        name: "sales.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Region,Rep\nMarmara,Ayşe\n"),
      },
      { name: "photo.heic", mimeType: "image/heic", buffer: Buffer.from([1]) },
      {
        name: "notes.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Release notes\n"),
      },
    ]);
    await expect(page.getByText("Marmara")).toBeVisible();

    await strip(page).getByRole("tab", { name: "photo.heic" }).click();
    await expect(page.locator('main [role="alert"]')).toContainText("can't open");

    // The strip has to survive the error, or the only way back to the files
    // that do work is to drop them again.
    await expect(strip(page).getByRole("tab")).toHaveCount(3);
    await strip(page).getByRole("tab", { name: "notes.md" }).click();
    await expect(
      page.getByRole("heading", { name: "Release notes" }),
    ).toBeVisible();
  });

  test("a drop past the cap says how many it kept", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles(
      'input[type="file"]',
      Array.from({ length: 25 }, (_, index) => ({
        name: `file-${index}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(`Name,Value\nrow,${index}\n`),
      })),
    );

    await expect(page.getByText("25 files were dropped")).toBeVisible();
    await expect(strip(page).getByRole("tab")).toHaveCount(20);
  });
});

/**
 * A folder produces a drop event with no files in it. Without a message the
 * gesture does nothing at all, which reads as the page ignoring you rather
 * than as a limit.
 */
test("a drop carrying no file says so", async ({ page }) => {
  await page.goto("/");

  // A real folder drop cannot be synthesised, but an empty DataTransfer
  // reproduces exactly what one delivers: a drop with `files` empty.
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page
    .getByTestId("drop-zone")
    .dispatchEvent("drop", { dataTransfer: transfer });

  await expect(page.locator('main [role="alert"]')).toContainText(
    "didn't contain a file",
  );
});
