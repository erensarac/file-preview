import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { FIXTURE_DIR } from "./fixtures";
import {
  allFiles,
  breadcrumbs,
  isMacMetadata,
  listArchive,
} from "@/lib/archive-tree";
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

    // The root of the archive, as folders rather than a flat list of paths.
    await expect(page.getByText("readme.txt")).toBeVisible();
    await expect(page.getByTestId("folder-docs")).toBeVisible();
    await expect(page.getByTestId("archive-summary")).toContainText("files");

    // The claim the whole product rests on: this one never left the device.
    expect(posts).toEqual([]);
  });

  test("shows a traversal-shaped name as text and nothing else", async ({
    page,
  }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("bundle.zip"));

    /*
     * Shown as what it is: a folder literally called "..", because the name is
     * split into labels and never resolved. Two levels down the file appears
     * under its own segment — visibly odd, which is the honest rendering of a
     * name that is itself an attempt at something.
     */
    await expect(page.getByTestId("folder-..")).toBeVisible();
    await page.getByTestId("folder-..").click();
    await page.getByTestId("folder-..").click();
    await page.getByTestId("folder-etc").click();
    await expect(page.getByText("passwd")).toBeVisible();

    // Nothing anywhere offers to follow it.
    await expect(page.getByRole("link", { name: /passwd/ })).toHaveCount(0);
  });

  test("a folder can be walked into and back out of", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("bundle.zip"));

    await page.getByTestId("folder-docs").click();
    // Inside: the file and the nested folder, not the whole archive flattened.
    await expect(page.getByText("guide.md")).toBeVisible();
    await expect(page.getByTestId("folder-img")).toBeVisible();
    await expect(page.getByText("readme.txt")).toHaveCount(0);

    await page.getByTestId("crumb-root").click();
    await expect(page.getByText("readme.txt")).toBeVisible();
  });

  test("a folder says how much is inside without being opened", async ({
    page,
  }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("bundle.zip"));

    // The row for `data` carries big.csv's size, which is the question a
    // folder row exists to answer.
    const row = page.locator("tr", { has: page.getByTestId("folder-data") });
    await expect(row).toContainText(/KB|bytes/);
  });

  test("filtering reaches the whole archive, not the folder in front of you", async ({
    page,
  }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("bundle.zip"));

    const filter = page.getByTestId("archive-filter");
    await filter.fill("guide");
    // Found from the root, and shown by its full path so the answer includes
    // where it is.
    await expect(page.getByText("docs/guide.md")).toBeVisible();
    await expect(page.getByText("readme.txt")).toHaveCount(0);

    await filter.press("Escape");
    await expect(page.getByText("readme.txt")).toBeVisible();
  });

  /**
   * The complaint this was built for: a zip made on macOS shows every file
   * twice, once real and once as a resource fork in a parallel tree.
   */
  test("a Finder archive shows each file once, and says what it hid", async ({
    page,
  }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("bundle.zip"));

    await expect(page.getByTestId("folder-__MACOSX")).toHaveCount(0);
    await expect(page.getByTestId("archive-hidden")).toContainText("hidden");

    await page.getByTestId("folder-docs").click();
    // .DS_Store is gone from inside the folder too, and guide.md appears once.
    await expect(page.getByText(".DS_Store")).toHaveCount(0);
    await expect(page.getByText("guide.md")).toHaveCount(1);
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

/**
 * Reading a flat list of names as the folders it stands for.
 *
 * A zip has no directories, only names with slashes in them, so the tree is an
 * agreement about how to read a list rather than something the format keeps.
 * These pin the terms of that agreement — including the one that matters most,
 * which is that a segment is a label and never a path component.
 */
test.describe("an archive read as folders", () => {
  const entry = (name: string, size = 100, directory = false) => ({
    name,
    compressedBytes: Math.round(size / 2),
    uncompressedBytes: size,
    encrypted: false,
    directory,
  });

  const bundle = [
    entry("readme.txt", 40),
    entry("docs/", 0, true),
    entry("docs/guide.md", 200),
    entry("docs/img/logo.png", 900),
    entry("data/big.csv", 5000),
  ];

  test("shows what is directly inside a folder, not everything below it", () => {
    const root = listArchive(bundle, "");
    expect(root.nodes.map((node) => node.name)).toEqual([
      "data",
      "docs",
      "readme.txt",
    ]);

    const docs = listArchive(bundle, "docs");
    // `img` is a folder here, not two files flattened into this level.
    expect(docs.nodes.map((node) => node.name)).toEqual(["img", "guide.md"]);
  });

  test("a folder carries what is under it", () => {
    const docs = listArchive(bundle, "")
      .nodes.find((node) => node.name === "docs")!;

    // 200 + 900: the point of a folder row is answering "how much is in here"
    // without opening it.
    expect(docs.uncompressedBytes).toBe(1100);
    expect(docs.files).toBe(2);
    expect(docs.directory).toBe(true);
  });

  test("folders come before files, and both alphabetically", () => {
    const order = listArchive(bundle, "").nodes.map((node) => ({
      name: node.name,
      directory: node.directory,
    }));
    expect(order[0]!.directory).toBe(true);
    expect(order[order.length - 1]!.name).toBe("readme.txt");
  });

  /**
   * The one that matters. `../../etc/passwd` is a legal name, and the tree must
   * show it rather than follow it: two folders literally called `..`, which is
   * both the truth about the file and visibly odd, where a resolved path would
   * be a quiet lie.
   */
  test("a traversal name becomes labels, never a path", () => {
    const hostile = [entry("../../etc/passwd", 10)];

    expect(listArchive(hostile, "").nodes.map((n) => n.name)).toEqual([".."]);
    expect(listArchive(hostile, "..").nodes.map((n) => n.name)).toEqual([".."]);
    expect(listArchive(hostile, "../../etc").nodes.map((n) => n.name)).toEqual([
      "passwd",
    ]);
  });

  test("the trail back up is derived from where you are", () => {
    expect(breadcrumbs("")).toEqual([]);
    expect(breadcrumbs("docs/img")).toEqual([
      { name: "docs", path: "docs" },
      { name: "img", path: "docs/img" },
    ]);
  });
});

/**
 * What Finder adds to a zip, and why hiding it is not the same as ignoring it.
 */
test.describe("macOS bookkeeping", () => {
  test("recognises the parallel tree and the stray files", () => {
    expect(isMacMetadata("__MACOSX/docs/._guide.md")).toBe(true);
    expect(isMacMetadata("__MACOSX/")).toBe(true);
    expect(isMacMetadata("docs/.DS_Store")).toBe(true);
    expect(isMacMetadata("._guide.md")).toBe(true);
  });

  test("does not mistake ordinary names for it", () => {
    // A file may legitimately start with a dot, or contain the word.
    expect(isMacMetadata(".gitignore")).toBe(false);
    expect(isMacMetadata("docs/macosx-notes.md")).toBe(false);
    expect(isMacMetadata("notes._draft.md")).toBe(false);
  });

  test("a Finder archive lists each file once, and says how many it hid", () => {
    const fromFinder = [
      { name: "photos/", compressedBytes: 0, uncompressedBytes: 0, encrypted: false, directory: true },
      { name: "photos/one.png", compressedBytes: 50, uncompressedBytes: 100, encrypted: false, directory: false },
      { name: "__MACOSX/", compressedBytes: 0, uncompressedBytes: 0, encrypted: false, directory: true },
      { name: "__MACOSX/photos/._one.png", compressedBytes: 60, uncompressedBytes: 120, encrypted: false, directory: false },
      { name: "photos/.DS_Store", compressedBytes: 30, uncompressedBytes: 60, encrypted: false, directory: false },
    ];

    const root = listArchive(fromFinder, "");
    // One folder, not two — the parallel tree is gone from the listing.
    expect(root.nodes.map((node) => node.name)).toEqual(["photos"]);
    // Two files hidden, and said so rather than leaving the count to disagree
    // with the archive's own.
    expect(root.hiddenMetadata).toBe(2);

    const photos = listArchive(fromFinder, "photos");
    expect(photos.nodes.map((node) => node.name)).toEqual(["one.png"]);
    // The real file's size, not the resource fork's.
    expect(photos.nodes[0]!.uncompressedBytes).toBe(100);
  });
});
