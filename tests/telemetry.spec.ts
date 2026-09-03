import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  FAILURE_PREFIX,
  formatFailure,
  safeErrorName,
  sizeBucket,
} from "@/lib/telemetry";
import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

/**
 * The value most worth constraining, because it is the only one that arrives
 * from outside. The client action is reachable by anyone and its output lands
 * in a log, so an unchecked field here is a way to write whatever you like
 * into our logs — including lines that impersonate other log entries.
 */
test.describe("what may end up in a log line", () => {
  test("an error class name survives", () => {
    expect(safeErrorName(new TypeError("boom"))).toBe("TypeError");
    expect(safeErrorName(new Error("boom"))).toBe("Error");
    expect(safeErrorName("ZipBombError")).toBe("ZipBombError");
  });

  test("anything that is not a class name does not", () => {
    for (const injected of [
      "file.failure format=xlsx error=Nothing",
      "Error\nfile.failure format=pdf",
      "Error; rm -rf /",
      "  Error  ",
      "",
      "a".repeat(80),
      { toString: () => "Error" },
      null,
      undefined,
      42,
    ]) {
      expect(safeErrorName(injected), `${String(injected)} got through`).toBe(
        "UnknownError",
      );
    }
  });

  test("sizes are banded, never exact", () => {
    expect(sizeBucket(1)).toBe("<64KB");
    expect(sizeBucket(500_000)).toBe("<1MB");
    expect(sizeBucket(3 * 1024 * 1024)).toBe("<4MB");
    expect(sizeBucket(20 * 1024 * 1024)).toBe("16MB+");
    expect(sizeBucket(-1)).toBe("unknown");
    expect(sizeBucket(Number.NaN)).toBe("unknown");
  });

  test("the line has a stable shape", () => {
    expect(
      formatFailure({
        formatId: "xlsx",
        runtime: "server",
        phase: "parse",
        errorName: "TypeError",
        sizeBucket: "<4MB",
      }),
    ).toBe(
      `${FAILURE_PREFIX} format=xlsx runtime=server phase=parse error=TypeError size=<4MB`,
    );
  });
});

/**
 * The report is the one thing a client-parsed file sends anywhere, and only
 * after it has already failed. What it may carry is the whole question.
 */
test.describe("a client failure report", () => {
  async function reportFor(page: Page, name: string) {
    const bodies: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") bodies.push(request.postData() ?? "");
    });

    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture(name));
    await expect(page.locator('main [role="alert"]')).toBeVisible();
    // The report is sent alongside the message rather than before it.
    await expect.poll(() => bodies.length).toBeGreaterThan(0);

    return bodies.join("\n");
  }

  test("is sent when a file fails to parse in the browser", async ({
    page,
  }) => {
    // A .pdf that is not a PDF: rejected by the adapter, in the browser.
    const body = await reportFor(page, "not-really.pdf");

    expect(body).toContain("pdf");
    expect(body).toContain("parse");
  });

  test("carries nothing derived from the file", async ({ page }) => {
    const body = await reportFor(page, "not-really.pdf");

    // The filename. Often the most sensitive part of a document — a name can
    // say plenty without the file being opened.
    expect(body, "the filename was sent").not.toContain("not-really");

    // The contents. The user-facing message is generic precisely because
    // parser errors quote file contents; logging what we refuse to display
    // would be perverse.
    expect(body, "file contents were sent").not.toContain("just some text");

    // The exact size, which is weakly identifying across reports.
    expect(body, "an exact byte count was sent").not.toMatch(/\b26\b/);
  });

  test("a file that opens sends nothing at all", async ({ page }) => {
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });

    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("sales.csv"));
    await expect(page.getByText("Marmara")).toBeVisible();

    // The privacy split is unchanged by any of this: a client format that
    // works still touches the network never.
    expect(posts).toEqual([]);
  });
});
