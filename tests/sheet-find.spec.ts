import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { findMatches, scrollTopFor, step } from "@/lib/sheet-find";
import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

/**
 * The matching itself, without a browser.
 *
 * Worth testing here rather than only through the UI: these are the decisions
 * a reader would otherwise have to infer from scrolling — what counts as a
 * match, and what happens at the ends of the list.
 */
test.describe("finding cells", () => {
  const rows = [
    ["Region", "Rep"],
    ["Marmara", "Ayşe"],
    ["Ege", "istanbul office"],
    ["", "Istanbul"],
  ];

  test("matches anywhere in a cell, ignoring case", () => {
    expect(findMatches(rows, "istanbul")).toEqual([
      { row: 2, column: 1, position: 2 },
      { row: 3, column: 1, position: 3 },
    ]);
  });

  test("an empty or blank query matches nothing at all", () => {
    // Not "everything": a find bar that highlights every cell the moment it is
    // focused is noise, and clearing the box has to clear the highlighting.
    expect(findMatches(rows, "")).toEqual([]);
    expect(findMatches(rows, "   ")).toEqual([]);
  });

  test("searches the view's order, and reports both places", () => {
    // The rows as they appear after a sort: the file's row 3 is on screen
    // first. A match has to carry both, because one number scrolls the page
    // and the other is what the row number shows.
    const order = [3, 2, 1, 0];
    expect(findMatches(rows, "istanbul", order)).toEqual([
      { row: 3, column: 1, position: 0 },
      { row: 2, column: 1, position: 1 },
    ]);
  });

  test("moving past either end wraps rather than stopping", () => {
    expect(step(2, 3, 1)).toBe(0);
    expect(step(0, 3, -1)).toBe(2);
    // With nothing found there is nowhere to go, and no division by zero.
    expect(step(0, 0, 1)).toBe(0);
  });

  test("a match is centred, but never past the ends of the sheet", () => {
    // Room on both sides: centred.
    expect(scrollTopFor(100, 33, 660, 1000)).toBe(100 * 33 - 660 / 2 + 33 / 2);
    // Near the top there is nothing above to show, so it clamps to 0 rather
    // than scrolling to a negative offset.
    expect(scrollTopFor(1, 33, 660, 1000)).toBe(0);
    // Near the bottom it stops where the sheet does.
    expect(scrollTopFor(999, 33, 660, 1000)).toBe(1000 * 33 - 660);
  });
});

/**
 * Why this exists at all: the browser's own find searches the page, and the
 * page is a window onto the file. Only the rows in view are mounted, so a
 * match thousands of rows down is in a row that does not exist yet.
 */
test.describe("a large sheet", () => {
  test("shows every row, with nothing about the first 2,000", async ({
    page,
  }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("large.csv"));

    const table = page.locator("table");
    await expect(table).toBeVisible();

    // The count assistive technology is given has to be the sheet's, not the
    // DOM's: 50,000 generated rows plus the file's own header line, which is
    // data here, plus the grid's header row.
    await expect(table).toHaveAttribute("aria-rowcount", "50002");

    // And no truncation notice, because nothing was truncated.
    await expect(page.getByText(/Showing the first/)).toHaveCount(0);
  });

  test("finds a row the browser's own search could never reach", async ({
    page,
  }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("large.csv"));
    await expect(page.locator("table")).toBeVisible();

    // Only a screenful is mounted, so the needle is genuinely absent from the
    // page before the search — this is the assertion that says the feature is
    // doing something the browser cannot.
    await expect(page.getByText("Trabzon")).toHaveCount(0);

    await page.getByTestId("sheet-find").fill("Trabzon");

    await expect(page.getByTestId("find-count")).toHaveText("1 of 1");
    const cell = page.getByTestId("match-current");
    await expect(cell).toBeVisible();
    await expect(cell).toHaveText("Trabzon");
  });

  test("moves between matches, and says which one is showing", async ({
    page,
  }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("large.csv"));
    await expect(page.locator("table")).toBeVisible();

    await page.getByTestId("sheet-find").fill("City 7");
    const count = page.getByTestId("find-count");
    await expect(count).toHaveText(/^1 of /);

    await page.getByRole("button", { name: "Next match" }).click();
    await expect(count).toHaveText(/^2 of /);

    // Enter and Shift+Enter are the same two moves from the keyboard.
    await page.getByTestId("sheet-find").press("Enter");
    await expect(count).toHaveText(/^3 of /);
    await page.getByTestId("sheet-find").press("Shift+Enter");
    await expect(count).toHaveText(/^2 of /);

    // Wrapping backwards from the first match goes to the last.
    await page.getByRole("button", { name: "Previous match" }).click();
    await page.getByRole("button", { name: "Previous match" }).click();
    await expect(count).not.toHaveText(/^0 of /);
  });

  test("says so when there is nothing to find, and Escape clears it", async ({
    page,
  }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("large.csv"));
    await expect(page.locator("table")).toBeVisible();

    const box = page.getByTestId("sheet-find");
    await box.fill("nothing-like-this-exists");
    await expect(page.getByTestId("find-count")).toHaveText("No matches");

    await box.press("Escape");
    await expect(box).toHaveValue("");
    await expect(page.getByTestId("find-count")).toBeEmpty();
  });
});

/**
 * The cap was never wrong on the server, where it bounds what a parser builds
 * inside a request. Lifting it there would be a different change with real
 * consequences, so this pins that it stayed.
 */
test("a server-parsed sheet still truncates, and still says so", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("wide.xlsx"));
  // Same allowance the other specs make for this fixture: 3 MB through a
  // server parse is past the default timeout once workers run in parallel.
  await expect(page.locator("table")).toBeVisible({ timeout: 30_000 });

  // Specific to the *row* notice: this sheet is past the column budget and the
  // cell budget too, so a loose match finds three notices and asserts nothing
  // about the one that matters here.
  await expect(page.getByText(/showing the first .* of 2,100 rows/)).toBeVisible();
});
