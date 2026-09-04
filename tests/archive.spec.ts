import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { FIXTURE_DIR } from "./fixtures";
import {
  assertSafeArchive,
  listCentralDirectory,
  locateCentralDirectory,
} from "@/lib/zip-guard";

const fixture = (name: string) => join(FIXTURE_DIR, name);
const bytesOf = (name: string) => new Uint8Array(readFileSync(fixture(name)));

/**
 * Reading an archive's index rather than its contents.
 *
 * The same walk that the bomb guard uses, which is the point: a listing that
 * read the directory differently from the code deciding whether to trust it
 * would be two opinions about one file.
 */
test.describe("reading a central directory", () => {
  test("finds the index without touching the compressed data", () => {
    const bytes = bytesOf("bundle.zip");
    const at = locateCentralDirectory(bytes.slice(-65_557), bytes.length);

    expect(at.entries).toBeGreaterThan(0);
    // The index lives at the end; if this ever pointed at byte 0 the slice
    // below would be reading compressed data by accident.
    expect(at.offset).toBeGreaterThan(0);
    expect(at.offset + at.size).toBeLessThanOrEqual(bytes.length);
  });

  test("lists every entry with the sizes it declares", () => {
    const bytes = bytesOf("bundle.zip");
    const at = locateCentralDirectory(bytes.slice(-65_557), bytes.length);
    const { files } = listCentralDirectory(
      bytes.slice(at.offset, at.offset + at.size),
      at.entries,
    );

    const names = files.map((entry) => entry.name);
    expect(names).toContain("readme.txt");
    expect(names).toContain("docs/guide.md");

    const csv = files.find((entry) => entry.name === "data/big.csv")!;
    // A repetitive CSV compresses hard; the point is that both numbers are
    // read from the archive rather than one being inferred from the other.
    expect(csv.uncompressedBytes).toBeGreaterThan(csv.compressedBytes);
  });

  test("a traversal-shaped name survives as text", () => {
    const bytes = bytesOf("bundle.zip");
    const at = locateCentralDirectory(bytes.slice(-65_557), bytes.length);
    const { files } = listCentralDirectory(
      bytes.slice(at.offset, at.offset + at.size),
      at.entries,
    );

    // Kept exactly as stored. Normalising it here would be the beginning of
    // treating it as a path, which is the mistake this format invites.
    expect(files.map((entry) => entry.name)).toContain("../../etc/passwd");
  });

  test("directories are marked rather than counted as files", () => {
    const bytes = bytesOf("bundle.zip");
    const at = locateCentralDirectory(bytes.slice(-65_557), bytes.length);
    const { files } = listCentralDirectory(
      bytes.slice(at.offset, at.offset + at.size),
      at.entries,
    );

    expect(files.some((entry) => entry.directory)).toBe(true);
  });

  /**
   * The guard is the reason this code exists at all, and it has to keep
   * refusing exactly what it refused before the listing was built on top of it.
   */
  test("the bomb guard still refuses what it always refused", () => {
    expect(() => assertSafeArchive(bytesOf("bomb.xlsx"))).toThrow();
    // And still passes a real workbook, which is the other half of that.
    expect(() => assertSafeArchive(bytesOf("report.xlsx"))).not.toThrow();
  });
});

test.describe("opening an archive", () => {
  test("lists what is inside, in the browser, with no upload", async ({
    page,
  }) => {
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });

    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("bundle.zip"));

    await expect(page.getByText("readme.txt")).toBeVisible();
    await expect(page.getByText("docs/guide.md")).toBeVisible();
    await expect(page.getByTestId("archive-summary")).toContainText("files");

    // The claim the whole product rests on: this one never left the device.
    expect(posts).toEqual([]);
  });

  test("shows a traversal-shaped name as text and nothing else", async ({
    page,
  }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("bundle.zip"));

    await expect(page.getByText("../../etc/passwd")).toBeVisible();
    // It is a table cell, not a link: nothing offers to follow it anywhere.
    await expect(page.getByRole("link", { name: /etc\/passwd/ })).toHaveCount(0);
  });

  test("filters by name, and Escape clears the filter", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("bundle.zip"));

    const filter = page.getByTestId("archive-filter");
    await filter.fill("guide");
    await expect(page.getByText("docs/guide.md")).toBeVisible();
    await expect(page.getByText("readme.txt")).toHaveCount(0);

    await filter.press("Escape");
    await expect(page.getByText("readme.txt")).toBeVisible();
  });

  /**
   * Office formats are zips. If detection ever preferred the archive listing,
   * every spreadsheet on the site would start opening as a directory of XML.
   */
  test("an .xlsx still opens as a spreadsheet", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("report.xlsx"));

    await expect(page.getByText("96200")).toBeVisible();
    await expect(page.getByTestId("archive-summary")).toHaveCount(0);
  });

  test("a file that is not a zip says so", async ({ page }) => {
    await page.goto("/");
    // A PDF renamed to .zip: it has no central directory to find.
    await page.setInputFiles('input[type="file"]', {
      name: "pretend.zip",
      mimeType: "application/zip",
      buffer: readFileSync(fixture("report.pdf")),
    });

    const alert = page.locator('main [role="alert"]');
    await expect(alert).toContainText(/zip archive/i);
  });
});
