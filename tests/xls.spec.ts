import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { detectFormat } from "@/lib/formats";
import { runParseInWorker, type WorkerLimits } from "@/lib/parse-runner";
import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);
const bytesOf = (name: string) =>
  new Uint8Array(readFileSync(fixture(name)));

const LIMITS: WorkerLimits = {
  maxRows: 2000,
  maxColumns: 200,
  maxCells: 100_000,
  maxSheets: 50,
  maxHtmlBytes: 2 * 1024 * 1024,
};

/**
 * The pre-2007 format is a different file that happens to open in the same
 * application: an OLE compound document of BIFF records rather than a zip of
 * XML. It needs its own parser, and the point of these is that everything
 * downstream of the parser stays the same.
 */
test.describe("a pre-2007 workbook", () => {
  test("is a format the registry knows", () => {
    const spec = detectFormat("ledger.xls", "application/vnd.ms-excel");
    expect(spec?.id).toBe("xls");
    // Same runtime and same ceiling as the modern format: it goes through the
    // same child process, and the deployment's body limit is the same.
    expect(spec?.runtime).toBe("server");
    expect(spec?.maxBytes).toBe(4 * 1024 * 1024);
  });

  test("parses to the same shape a modern workbook does", async () => {
    const { result } = await runParseInWorker(
      "xls",
      bytesOf("ledger.xls"),
      LIMITS,
    );

    expect(result.kind).toBe("sheet");
    if (result.kind !== "sheet") return;
    expect(result.sheets.map((sheet) => sheet.name)).toEqual(["Q1", "Notes"]);
    expect(JSON.stringify(result.sheets[0]!.rows)).toContain("Karadeniz");
  });

  /**
   * The budgets have to apply to the new parser too. A second library brought
   * in for one format is a second way to spend an unbounded amount of someone
   * else's file if its output is not capped where everything else is.
   */
  test("is held to the same budgets as the modern parser", async () => {
    const { result, notices } = await runParseInWorker(
      "xls",
      bytesOf("ledger.xls"),
      { ...LIMITS, maxRows: 2, maxColumns: 2 },
    );

    if (result.kind !== "sheet") throw new Error("expected a sheet");
    expect(result.sheets[0]!.rows.length).toBeLessThanOrEqual(2);
    for (const row of result.sheets[0]!.rows) {
      expect(row.length).toBeLessThanOrEqual(2);
    }
    // The same wording the modern path produces: a reader should not be able
    // to tell which parser was used.
    expect(notices.join(" ")).toContain("showing the first");
  });

  test("runs inside the same time ceiling", async () => {
    const failure = await runParseInWorker(
      "xls",
      bytesOf("ledger.xls"),
      LIMITS,
      1,
    ).catch((error: unknown) => error);

    expect((failure as Error).constructor.name).toBe("ParseTimeoutError");
  });

  /**
   * The case that motivated routing by signature rather than by name. These
   * files are old enough that plenty of them have been renamed at some point,
   * and `exceljs` answering "this is not a valid archive" about a perfectly
   * good workbook is a bad way to find that out.
   */
  test("opens even when it is wearing the modern extension", async () => {
    const { result } = await runParseInWorker(
      "xlsx",
      bytesOf("misnamed.xlsx"),
      LIMITS,
    );

    expect(result.kind).toBe("sheet");
    if (result.kind !== "sheet") return;
    expect(JSON.stringify(result.sheets[0]!.rows)).toContain("Marmara");
  });

  test("a modern workbook still goes to the modern parser", async () => {
    const { result } = await runParseInWorker(
      "xlsx",
      bytesOf("report.xlsx"),
      LIMITS,
    );

    if (result.kind !== "sheet") throw new Error("expected a sheet");
    // The formula's computed value, which is exceljs's answer rather than the
    // legacy parser's — so the signature check did not send it the wrong way.
    expect(JSON.stringify(result.sheets[0]!.rows)).toContain("96200");
  });
});

/**
 * Through the action rather than the parser, which is where the archive guard
 * lives — and the guard rejects anything that is not a zip. A misnamed file
 * arrives declared as `xlsx`, so scoping that guard by format id would have
 * left this exact case broken while the parser tests all passed.
 */
test("a misnamed old workbook opens through the upload path", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("misnamed.xlsx"));

  await expect(page.getByText("Marmara")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
});

test("an .xls opens in the browser like any other spreadsheet", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("ledger.xls"));

  await expect(page.getByText("Karadeniz")).toBeVisible({ timeout: 30_000 });
  // Two sheets, so the tab strip is there and the format is not being flattened.
  await expect(page.getByRole("tab", { name: "Notes" })).toBeVisible();
});
