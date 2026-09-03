import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { looksEncryptedOffice } from "@/lib/encrypted";
import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);
const bytesOf = (name: string) => new Uint8Array(readFileSync(fixture(name)));

async function open(page: Page, name: string) {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture(name));
}

const banner = (page: Page) => page.locator('main [role="alert"]');

/**
 * The detector, checked directly.
 *
 * Both halves matter: firing on a locked file, and *not* firing on things that
 * merely look like one. A false positive here tells someone their file is
 * password-protected when it is something else entirely, which is worse than
 * the vague message this replaces.
 */
test.describe("detecting a locked Office file", () => {
  test("recognises the encrypted package", () => {
    expect(looksEncryptedOffice(bytesOf("locked.xlsx"))).toBe(true);
  });

  test("a real workbook is not mistaken for one", () => {
    expect(looksEncryptedOffice(bytesOf("report.xlsx"))).toBe(false);
  });

  /**
   * The OLE signature alone is not enough. A genuine pre-2007 `.xls` renamed to
   * `.xlsx` carries it too, and that is a different problem with a different
   * answer — so it must fall through rather than being mislabelled as locked.
   */
  test("a legacy OLE file is not mistaken for one", () => {
    expect(looksEncryptedOffice(bytesOf("legacy.xlsx"))).toBe(false);
  });

  test("random bytes are not mistaken for one", () => {
    expect(looksEncryptedOffice(bytesOf("broken.xlsx"))).toBe(false);
    expect(looksEncryptedOffice(new Uint8Array(0))).toBe(false);
  });
});

test.describe("what the user is told", () => {
  test("a locked spreadsheet names the password, not corruption", async ({
    page,
  }) => {
    await open(page, "locked.xlsx");

    await expect(banner(page)).toContainText("password-protected");
    // The old message hedged between corrupt and locked, which sent people
    // away from a problem they could have fixed in seconds.
    await expect(banner(page)).not.toContainText("corrupt");
    // And it says why there is no password box, rather than leaving it a
    // puzzle: the password would have to travel to the server with the file.
    await expect(banner(page)).toContainText("sent to our server");
  });

  test("a locked PDF says so too", async ({ page }) => {
    await open(page, "locked.pdf");

    // pdf.js raises this as "No password given", which reads as something the
    // site failed to do rather than as a property of the file.
    await expect(banner(page)).toContainText("password-protected");
    await expect(banner(page)).not.toContainText("No password given");
  });

  /**
   * The distinction only means something if the other message still exists.
   * A detector that labelled everything as locked would pass every test above.
   */
  test("a genuinely unreadable file still says that", async ({ page }) => {
    await open(page, "broken.xlsx");

    await expect(banner(page)).toContainText("couldn't read");
    await expect(banner(page)).not.toContainText("password");
  });

  test("a locked file is never sent to a parser", async ({ page }) => {
    await open(page, "locked.xlsx");
    await expect(banner(page)).toContainText("password-protected");

    // Detection happens before the archive guard and before exceljs, so
    // nothing has tried to open the container. If a parser had run, the
    // generic handler would have logged and produced its own message.
    await expect(banner(page)).not.toContainText("expands to far more");
  });
});
