import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  PARSE_MEMORY_MB,
  PARSE_TIMEOUT_MS,
  ParseMemoryError,
  ParserError,
  ParseTimeoutError,
  ParseUnavailableError,
  runParseInWorker,
  type WorkerLimits,
} from "@/lib/parse-runner";
import { FIXTURE_DIR } from "./fixtures";

const bytesOf = (name: string) =>
  new Uint8Array(readFileSync(join(FIXTURE_DIR, name)));

const LIMITS: WorkerLimits = {
  maxRows: 2000,
  maxColumns: 200,
  maxCells: 100_000,
  maxSheets: 50,
  maxHtmlBytes: 2 * 1024 * 1024,
};

/**
 * The parse runs in a process of its own so that it can be *stopped* — on time
 * and on memory.
 *
 * A thread was the first version and could do neither honestly: a worker's
 * `resourceLimits` is accepted, reported back, and ignored. A process started
 * with `--max-old-space-size` genuinely dies at its ceiling.
 */
test.describe("running a parse in its own process", () => {
  test("a workbook comes back with its budgets applied", async () => {
    const { result, notices } = await runParseInWorker(
      "xlsx",
      bytesOf("report.xlsx"),
      LIMITS,
    );

    expect(result.kind).toBe("sheet");
    if (result.kind !== "sheet") return;

    expect(result.sheets.map((sheet) => sheet.name)).toEqual(["Q1", "Notes"]);
    // The formula cell carries what Excel computed, not the expression.
    expect(JSON.stringify(result.sheets[0]!.rows)).toContain("96200");
    expect(notices).toEqual([]);
  });

  test("a document comes back raw, for the sanitizer on this side", async () => {
    const { result } = await runParseInWorker(
      "docx",
      bytesOf("summary.docx"),
      LIMITS,
    );

    expect(result.kind).toBe("raw-html");
    if (result.kind !== "raw-html") return;
    expect(result.html).toContain("Quarterly Summary");
  });

  /**
   * The caps have to be applied inside the worker, not after it returns —
   * their point is to bound what the parse *produces*, and a cap applied on
   * the far side would mean the whole grid had already been built.
   */
  test("the budgets are enforced where the work happens", async () => {
    const { result, notices } = await runParseInWorker(
      "xlsx",
      bytesOf("wide.xlsx"),
      { ...LIMITS, maxRows: 5, maxColumns: 3, maxCells: 12 },
    );

    if (result.kind !== "sheet") throw new Error("expected a sheet");
    expect(result.sheets[0]!.rows.length).toBeLessThanOrEqual(5);
    for (const row of result.sheets[0]!.rows) {
      expect(row.length).toBeLessThanOrEqual(3);
    }
    expect(notices.join(" ")).toContain("showing the first 3");
  });

  test("a parser's own failure comes back as one, not as a crash", async () => {
    // A .xlsx that is not a zip at all.
    const failure = await runParseInWorker(
      "xlsx",
      new Uint8Array(Buffer.from("not a spreadsheet")),
      LIMITS,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ParserError);
    // Reported rather than thrown, so the runner sees a result and the caller
    // can log the detail without it reaching the browser.
    expect((failure as ParserError).parserName).toBeTruthy();
  });

  /**
   * The budget itself. A worker takes tens of milliseconds simply to start, so
   * a 1 ms budget cannot be met by any parse and drives the timeout path every
   * time — which is the path with no other way to reach it.
   */
  test("a parse past its budget is stopped", async () => {
    const failure = await runParseInWorker(
      "xlsx",
      bytesOf("wide.xlsx"),
      LIMITS,
      1,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ParseTimeoutError);
    expect((failure as Error).message).toContain("stopped");
  });

  /**
   * Being stopped must not poison what comes next. If a killed worker left the
   * runner in a bad state, this is where it would show — and in the request
   * path it would mean one hostile file breaking every upload after it.
   */
  test("a stopped parse leaves the next one working", async () => {
    await runParseInWorker("xlsx", bytesOf("wide.xlsx"), LIMITS, 1).catch(
      () => undefined,
    );

    const { result } = await runParseInWorker(
      "xlsx",
      bytesOf("report.xlsx"),
      LIMITS,
    );
    expect(result.kind).toBe("sheet");
  });

  /**
   * The ceiling a thread could not give. `resourceLimits` on a worker was
   * accepted, reported back correctly, and ignored — measured at 138x the
   * stated limit — so this is the assertion that says the ceiling is real.
   */
  test("a parse past its memory ceiling is stopped", async () => {
    const failure = await runParseInWorker(
      "xlsx",
      bytesOf("wide.xlsx"),
      LIMITS,
      30_000,
      // Far below what a 3 MB workbook needs, so V8 gives up rather than the
      // parse merely being slow — and the timeout is generous so a timeout
      // cannot be what this catches.
      24,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ParseMemoryError);
    expect((failure as Error).message).toContain("24MB");
  });

  test("a memory kill leaves the next parse working", async () => {
    await runParseInWorker("xlsx", bytesOf("wide.xlsx"), LIMITS, 30_000, 24)
      .catch(() => undefined);

    const { result } = await runParseInWorker(
      "xlsx",
      bytesOf("report.xlsx"),
      LIMITS,
    );
    expect(result.kind).toBe("sheet");
  });

  /**
   * The failure a deployment can have while every local test passes.
   *
   * `next.config.ts` forces the child into the traced output because nothing
   * imports it; if that directive ever stops working the file is simply not
   * deployed. Production then answers every Office upload with a message about
   * the *file* being unreadable — which is what it did, until a check that
   * uploads a real workbook to the real deployment said otherwise.
   */
  test("a missing child is our failure, and says so", async () => {
    const failure = await runParseInWorker(
      "xlsx",
      bytesOf("report.xlsx"),
      LIMITS,
      PARSE_TIMEOUT_MS,
      PARSE_MEMORY_MB,
      join(FIXTURE_DIR, "no-such-child.mjs"),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ParseUnavailableError);
    // Not a ParserError: that class means a parser read the file and refused
    // it, which is the opposite claim and the opposite message.
    expect(failure).not.toBeInstanceOf(ParserError);
    // Node's own reason is carried through, so a log says which of the two
    // shapes of "not there" happened.
    expect((failure as Error).message).toMatch(/cannot find module/i);
  });

  test("the defaults sit between what files need and what the platform allows", () => {
    // A parse has to fail with our message rather than the deployment's
    // timeout page, which says nothing a user can act on.
    expect(PARSE_TIMEOUT_MS).toBeGreaterThan(1_000);
    expect(PARSE_TIMEOUT_MS).toBeLessThan(10_000);

    // Comfortably above what the fixtures expand to (~27 MB) and far below any
    // plausible function size, so a real document never meets it.
    expect(PARSE_MEMORY_MB).toBeGreaterThan(64);
    expect(PARSE_MEMORY_MB).toBeLessThan(1_024);
  });
});
