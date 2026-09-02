import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { FORMATS } from "@/lib/formats";
import { LANDING_PAGES } from "@/lib/landing";
import { FIXTURE_DIR } from "./fixtures";

test("every landing page names a format the registry knows", () => {
  // The pages and the parsing registry are separate files by design, so a
  // format renamed or removed would otherwise leave a page pointing at
  // nothing — and getFormat throws at render time rather than build time.
  const known = new Set(FORMATS.map((format) => format.id));
  const orphaned = LANDING_PAGES.filter((page) => !known.has(page.formatId));
  expect(orphaned).toEqual([]);
});

test("titles and descriptions are distinct", () => {
  // Pages that share a title compete with each other in search results
  // instead of covering different queries.
  const titles = LANDING_PAGES.map((page) => page.title);
  const descriptions = LANDING_PAGES.map((page) => page.description);

  expect(new Set(titles).size).toBe(titles.length);
  expect(new Set(descriptions).size).toBe(descriptions.length);
});

for (const page of LANDING_PAGES) {
  test(`/${page.slug} is indexable and usable`, async ({ browser }) => {
    const context = await browser.newContext();
    const tab = await context.newPage();
    const response = await tab.goto(`/${page.slug}`);

    expect(response?.status()).toBe(200);
    await expect(tab).toHaveTitle(page.title);
    await expect(
      tab.getByRole("heading", { level: 1, name: page.headline }),
    ).toBeVisible();

    const meta = tab.locator('meta[name="description"]');
    await expect(meta).toHaveAttribute("content", page.description);

    // A canonical pointing at the wrong URL is worse than none: it tells a
    // crawler to index a different page instead of this one.
    const canonical = tab.locator('link[rel="canonical"]');
    expect(await canonical.getAttribute("href")).toContain(`/${page.slug}`);

    // The page has to actually work, not just describe the tool.
    await expect(tab.getByRole("button", { name: "Choose file" })).toBeVisible();
    await context.close();
  });
}

test("an unknown viewer slug is a 404, not an empty page", async ({ page }) => {
  const response = await page.goto("/not-a-real-viewer");
  expect(response?.status()).toBe(404);
});

test("a landing page opens files like the home page does", async ({ page }) => {
  await page.goto("/csv-viewer");
  await page.setInputFiles(
    'input[type="file"]',
    join(FIXTURE_DIR, "sales.csv"),
  );

  await expect(page.getByText("Marmara")).toBeVisible();
  await expect(page.getByText("Ali, Jr.")).toBeVisible();
});

test("the sitemap lists the home page and every landing page", async ({
  page,
}) => {
  const response = await page.goto("/sitemap.xml");
  expect(response?.status()).toBe(200);

  const xml = await response!.text();
  for (const landing of LANDING_PAGES) {
    expect(xml).toContain(`/${landing.slug}`);
  }
  // Plus the home page: one <url> more than there are landing pages.
  expect(xml.match(/<url>/g) ?? []).toHaveLength(LANDING_PAGES.length + 1);
});

test("robots.txt allows crawling and points at the sitemap", async ({
  page,
}) => {
  const response = await page.goto("/robots.txt");
  expect(response?.status()).toBe(200);

  const text = await response!.text();
  expect(text).toContain("Allow: /");
  expect(text).toContain("/sitemap.xml");
});
