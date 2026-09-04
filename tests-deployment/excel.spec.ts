import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { FIXTURE_DIR } from "../tests/fixtures";

/**
 * The one thing the local suite cannot check: that an Excel upload works **on
 * the platform**.
 *
 * Three assumptions have been resting on "it works locally" since they were
 * written, and each fails in a way no local run can reproduce:
 *
 * - `next.config.ts` forces `lib/parse-child.mjs` into the traced output.
 *   Nothing imports it, so if that directive stopped working the file would
 *   simply not be deployed, and every Office upload would fail on a
 *   deployment that started perfectly.
 * - The parser runs in a **child process**, spawned with `process.execPath`.
 *   Whether a serverless function may spawn one at all is a property of the
 *   platform, not of the code.
 * - The 8 s parse ceiling was chosen against measurements from a development
 *   container with 16 GB and no cgroup limit. The function's own budget is
 *   smaller, and the spawn cost on a cold instance was never measured.
 *
 * One upload answers all three: if the file is missing or the spawn is refused,
 * the parse fails rather than being slow.
 */
test("an Excel file opens on the deployment", async ({ page }) => {
  /*
   * Every upload's response, recorded as it lands. The page can only show what
   * the client made of a request; this is what the platform actually said.
   */
  const posts: string[] = [];
  const started = Date.now();
  page.on("response", (response) => {
    if (response.request().method() !== "POST") return;
    posts.push(
      `${response.status()} after ${Date.now() - started} ms — ${response.url()}`,
    );
  });
  page.on("requestfailed", (request) => {
    if (request.method() !== "POST") return;
    posts.push(
      `FAILED after ${Date.now() - started} ms — ${request.failure()?.errorText}`,
    );
  });

  await page.goto("/");

  const first = Date.now();
  await page.setInputFiles(
    'input[type="file"]',
    join(FIXTURE_DIR, "report.xlsx"),
  );

  /*
   * Whichever comes first, and then say which.
   *
   * A check that can only report "the value never appeared" leaves whoever
   * reads it to guess between a missing traced file, a refused spawn, a
   * timeout and a rate limit — and each of those produces a *different*
   * message on screen. Racing the outcomes and logging the alert turns sixty
   * seconds of silence into the app's own account of what went wrong.
   */
  /*
   * Print the page, then assert.
   *
   * The previous version raced the value against the error region and logged
   * the alert — and reported neither: the race resolved quickly, the alert
   * count was zero, and the value never appeared. Three sentences of log that
   * ruled nothing out. Anything that has to be deduced from an absence should
   * have been printed instead, so this prints what is actually there.
   */
  const parsed = page.getByText("96200");
  /*
   * Scoped to `main`, because `[role="alert"]` on its own matches Next's route
   * announcer — always present, always empty, and it won the previous race
   * instantly. Two diagnostics were spent before that was noticed; the first
   * rule of reading a page is to know whose element you are looking at.
   */
  const failed = page.locator('main [role="alert"]');

  const outcome = await Promise.race([
    parsed
      .first()
      .waitFor({ state: "visible", timeout: 90_000 })
      .then(() => "parsed"),
    failed
      .first()
      .waitFor({ state: "visible", timeout: 90_000 })
      .then(() => "refused"),
  ]).catch(() => "neither");

  console.log(`  outcome: ${outcome}`);
  for (const text of await failed.allInnerTexts()) {
    console.log(`  message: ${text}`);
  }
  /*
   * The decisive line. The app's own parse ceiling is 8 s, so a parse that
   * hangs reports itself long before this test gives up — and it did not. That
   * points past our code at the request itself, and only the response can say
   * whether it came back 504, 500, or never came back at all.
   */
  for (const post of posts) {
    console.log(`  POST ${post}`);
  }
  console.log(
    `  page: ${(await page.locator("main").innerText())
      .slice(0, 400)
      .replace(/\n+/g, " | ")}`,
  );

  await expect(parsed).toBeVisible();
  const firstMs = Date.now() - first;

  const second = Date.now();
  await page.setInputFiles(
    'input[type="file"]',
    join(FIXTURE_DIR, "ledger.xls"),
  );
  await expect(page.getByText("Karadeniz")).toBeVisible();
  const secondMs = Date.now() - second;

  console.log(`  first upload  ${firstMs} ms  (.xlsx, exceljs)`);
  console.log(`  second upload ${secondMs} ms  (.xls, SheetJS)`);
  console.log(
    "  Note: 'first' is the first upload of this run, which is not the same " +
      "as a cold instance — the platform may already have one warm.",
  );

  // Deliberately loose. This is a measurement, not a budget: a number tight
  // enough to be meaningful here would fail on a slow day and teach everyone
  // to re-run it.
  expect(firstMs).toBeLessThan(60_000);
});

/**
 * The pre-2007 parser is the newest dependency and the one fetched from a
 * vendor CDN rather than the registry. That it is present in the deployed
 * bundle at all is worth asserting where the bundle actually is.
 */
test("a locked file still explains itself on the deployment", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles(
    'input[type="file"]',
    join(FIXTURE_DIR, "locked.xlsx"),
  );

  const alert = page.locator('main [role="alert"]');
  await expect(alert).toContainText(/password/i);
});
