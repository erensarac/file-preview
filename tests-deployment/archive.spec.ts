import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { FIXTURE_DIR } from "../tests/fixtures";

/**
 * A file opened from *inside* an archive, on the platform.
 *
 * The local suite covers this end to end already, so what is left for a
 * deployment run is the half of the journey a local server cannot fake. The
 * bytes are cut out of the zip in the browser with `DecompressionStream` and
 * then posted to the server action, which spawns a child process to parse
 * them — two mechanisms that were each broken in production while every local
 * test stayed green, and which nothing but a real upload puts together.
 *
 * `reports/quarter.xlsx` inside `bundle.zip` is the same workbook the drop
 * test uses, so 96200 arriving here means the whole chain worked: central
 * directory read, local header seeked, entry inflated, file rebuilt,
 * uploaded, parsed off-process, rendered.
 */
test("a spreadsheet inside an archive opens on the deployment", async ({
  page,
}) => {
  const posts: string[] = [];
  const started = Date.now();
  page.on("response", (response) => {
    if (response.request().method() !== "POST") return;
    posts.push(`${response.status()} after ${Date.now() - started} ms`);
  });

  await page.goto("/");
  await page.setInputFiles(
    'input[type="file"]',
    join(FIXTURE_DIR, "bundle.zip"),
  );

  // The listing itself is client-side work, and it happening at all is the
  // precondition for everything below.
  await expect(page.getByTestId("archive-summary")).toBeVisible();

  await page.getByTestId("folder-reports").click();
  await page.getByTestId("entry-quarter.xlsx").click();

  const parsed = page.getByText("96200");
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

  // Printed rather than deduced from an absence, for the same reason the
  // Excel check prints: "the value never appeared" names none of the four
  // things that could have stopped it.
  console.log(`  outcome: ${outcome}`);
  for (const text of await failed.allInnerTexts()) console.log(`  message: ${text}`);
  for (const post of posts) console.log(`  POST ${post}`);

  await expect(parsed).toBeVisible();
  // And it says where it was parsed, which is the promise the refusal used to
  // keep by refusing.
  await expect(page.getByText("converted on server")).toBeVisible();
});

/**
 * The other half of the same rule, checked where it matters most: a format
 * read in the browser is still read in the browser when it comes out of an
 * archive. If extraction ever started routing everything through the upload
 * path, this is what would say so.
 */
test("a text entry inside an archive never leaves the browser", async ({
  page,
}) => {
  await page.goto("/");

  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });

  await page.setInputFiles(
    'input[type="file"]',
    join(FIXTURE_DIR, "bundle.zip"),
  );
  await page.getByTestId("entry-readme.txt").click();

  await expect(page.getByText("read locally")).toBeVisible();
  expect(posts).toEqual([]);
});
