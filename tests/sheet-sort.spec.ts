import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { compareCells, nextDirection, sortedOrder } from "@/lib/sheet-sort";
import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

/**
 * A spreadsheet column is not a type, so "sorted" has to be defined before it
 * can be right. These are the definitions, tested where they are stated rather
 * than inferred from a screenshot of a sorted grid.
 */
test.describe("the order a column is put in", () => {
  test("numbers compare as numbers, not as text", () => {
    // The bug this prevents: 10 sorting before 9 because "1" < "9".
    expect(compareCells("9", "10", "asc")).toBeLessThan(0);
    expect(compareCells("10", "9", "asc")).toBeGreaterThan(0);
  });

  test("a value that is only partly a number stays text", () => {
    // "10 kg" must not quietly become 10; it sorts among the words.
    expect(compareCells("10 kg", "9", "asc")).toBeGreaterThan(0);
  });

  test("blanks sink in both directions", () => {
    // The whole point: reversing the sort must not fill the top of the screen
    // with empty rows.
    expect(compareCells("", "anything", "asc")).toBeGreaterThan(0);
    expect(compareCells("", "anything", "desc")).toBeGreaterThan(0);
    expect(compareCells("   ", "5", "desc")).toBeGreaterThan(0);
  });

  test("text compares by locale rather than by code point", () => {
    // Ç belongs next to C. Sorting by code point puts it after Z, which in a
    // Turkish column is simply wrong.
    expect(compareCells("Çankaya", "Denizli", "asc")).toBeLessThan(0);
  });

  test("equal values keep the order the file gave them", () => {
    const rows = [["b"], ["a"], ["a"], ["b"]];
    // Rows 1 and 2 both hold "a" and must stay in that order.
    expect(sortedOrder(rows, [0, 1, 2, 3], 0, "asc")).toEqual([1, 2, 0, 3]);
  });

  test("clicking through a column returns to the file's own order", () => {
    expect(nextDirection(null)).toBe("asc");
    expect(nextDirection("asc")).toBe("desc");
    // Not back to ascending: there has to be a way to see the file as it is.
    expect(nextDirection("desc")).toBeNull();
  });
});

test.describe("sorting and filtering a sheet", () => {
  test("sorts a column, and gives the file's order back", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("sales.csv"));

    const firstCell = page.locator("tbody tr td:nth-child(3)").first();
    await expect(firstCell).toHaveText("Rep");

    // Column B is the header row plus three names; ascending puts the header
    // text among them by locale, so assert on what actually leads.
    await page.getByTestId("sort-2").click();
    await expect(page.locator("th").nth(3)).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    const ascending = await firstCell.textContent();

    await page.getByTestId("sort-2").click();
    await expect(page.locator("th").nth(3)).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(await firstCell.textContent()).not.toBe(ascending);

    // A third click is the way back to the file itself.
    await page.getByTestId("sort-2").click();
    await expect(page.locator("th").nth(3)).toHaveAttribute("aria-sort", "none");
    await expect(firstCell).toHaveText("Rep");
  });

  test("a sorted row keeps the number it has in the file", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("sales.csv"));

    await page.getByTestId("sort-3").click();
    // The row numbers are the file's, so a sorted view can still be compared
    // against the original. A view that renumbers 1..n cannot be.
    const numbers = await page
      .locator("tbody tr td:first-child")
      .allInnerTexts();
    expect(numbers).not.toEqual(["1", "2", "3", "4"]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  test("filtering hides rows and says how many", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("large.csv"));
    await expect(page.locator("table")).toBeVisible();

    await page.getByTestId("sheet-find").fill("Trabzon");
    await page.getByTestId("only-matching").check();

    await expect(page.getByTestId("hidden-count")).toContainText("hidden");
    // One row survives, and it is the one that matched.
    await expect(page.locator("tbody tr td:nth-child(3)")).toHaveText(
      "Trabzon",
    );
  });

  test("find still points at what is on screen after a sort", async ({
    page,
  }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("large.csv"));
    await expect(page.locator("table")).toBeVisible();

    // Sorting moves the needle far from where it sits in the file. If find
    // scrolled by row number rather than by position, this would land on some
    // unrelated row and the highlighted cell would not be the match.
    await page.getByTestId("sort-2").click();
    await page.getByTestId("sheet-find").fill("Trabzon");

    const cell = page.getByTestId("match-current");
    await expect(cell).toBeVisible();
    await expect(cell).toHaveText("Trabzon");
  });

  test("a truncated sheet says what the sort covered", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("wide.xlsx"));
    // 3 MB uploaded, parsed in a child process and rendered — comfortably past
    // the default expect timeout when the suite runs its workers in parallel,
    // as the other specs using this fixture already allow for.
    await expect(page.locator("table")).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId("sort-scope")).toHaveCount(0);
    await page.getByTestId("sort-1").click();

    // Sorting 500 of 2,100 rows and calling it sorted would let someone read
    // the largest value on screen as the largest in the file.
    await expect(page.getByTestId("sort-scope")).toContainText(
      "within the first",
    );
  });
});
