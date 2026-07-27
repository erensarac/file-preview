import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { createBulkhead, TooBusyError } from "@/lib/concurrency";
import {
  assertSafeArchive,
  inspectZip,
  NotAZipError,
  ZipBombError,
} from "@/lib/zip-guard";
import { FIXTURE_DIR } from "./fixtures";

/**
 * These exercise the server-side guards directly rather than through the
 * browser. The behaviour that matters — refusing work before it is done — has
 * no visible surface beyond an error message, so asserting it through the UI
 * would prove much less than calling it.
 */

const bytesOf = (name: string) =>
  new Uint8Array(readFileSync(join(FIXTURE_DIR, name)));

test.describe("zip guard", () => {
  test("reads declared sizes without inflating the archive", () => {
    const report = inspectZip(bytesOf("report.xlsx"));
    expect(report.entries).toBeGreaterThan(0);
    expect(report.uncompressedBytes).toBeGreaterThan(report.compressedBytes);
  });

  test("accepts genuine Office files", () => {
    // A wide workbook is the worst legitimate case in the fixtures: ~2.95 MB
    // stored, ~26.6 MB expanded, so about 9x.
    const report = assertSafeArchive(bytesOf("wide.xlsx"));
    expect(report.ratio).toBeLessThan(20);

    expect(() => assertSafeArchive(bytesOf("report.xlsx"))).not.toThrow();
    expect(() => assertSafeArchive(bytesOf("summary.docx"))).not.toThrow();
  });

  test("refuses a decompression bomb", () => {
    const bomb = bytesOf("bomb.xlsx");

    // The point of the guard: the verdict comes from the headers, so the 64 MB
    // this file expands to is never allocated.
    const report = inspectZip(bomb);
    expect(report.ratio).toBeGreaterThan(500);

    expect(() => assertSafeArchive(bomb)).toThrow(ZipBombError);
  });

  test("rejects input that is not a zip at all", () => {
    expect(() => inspectZip(new Uint8Array([1, 2, 3]))).toThrow(NotAZipError);
    expect(() => inspectZip(new Uint8Array(512))).toThrow(NotAZipError);
  });

  test("rejects a truncated central directory", () => {
    const real = bytesOf("report.xlsx");
    // Keep the end-of-central-directory record but corrupt where it points.
    const truncated = real.slice(0, real.length - 40);
    expect(() => inspectZip(truncated)).toThrow(NotAZipError);
  });
});

test.describe("bulkhead", () => {
  test("sheds work past the limit instead of queueing it", async () => {
    const run = createBulkhead(2);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = run(() => blocked);
    const second = run(() => blocked);
    // Both slots are occupied, so this must fail immediately rather than wait.
    await expect(run(async () => "third")).rejects.toThrow(TooBusyError);

    release();
    await Promise.all([first, second]);

    // Slots are returned once the tasks settle.
    await expect(run(async () => "later")).resolves.toBe("later");
  });

  test("returns a slot even when the task throws", async () => {
    const run = createBulkhead(1);
    await expect(
      run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(run(async () => "ok")).resolves.toBe("ok");
  });
});

test("a bomb uploaded through the UI is refused, not opened", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', join(FIXTURE_DIR, "bomb.xlsx"));

  await expect(page.locator('main [role="alert"]')).toContainText(
    "expands to far more than its size suggests",
  );
  // Nothing should have rendered.
  await expect(page.locator("table")).toHaveCount(0);
});
