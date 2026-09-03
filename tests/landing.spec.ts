import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

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

/**
 * Link previews.
 *
 * The six landing pages exist to be found and shared, and a card is the first
 * thing most people see of any of them. These assert the tags are present and
 * that the images they point at actually resolve — a generated image route can
 * disappear in a metadata refactor without anything else failing, and the loss
 * is invisible until someone pastes a link somewhere.
 */
test.describe("link preview cards", () => {
  const contentOf = (tab: Page, selector: string) =>
    tab.locator(selector).getAttribute("content");

  /**
   * Open Graph URLs are absolute — a scraper has no page to resolve them
   * against — and their origin comes from `lib/site.ts`, which is Vercel's
   * production domain when deployed and `localhost:3000` otherwise. The suite
   * runs on a different port, so the path is what gets fetched here; the
   * origin is an environment concern rather than something these can assert.
   */
  const fetchByPath = (tab: Page, absolute: string) =>
    tab.request.get(new URL(absolute).pathname + new URL(absolute).search);

  test("the home page has a card, and it resolves", async ({ page }) => {
    await page.goto("/");

    const url = await contentOf(page, 'meta[property="og:image"]');
    expect(url, "no og:image on the home page").toBeTruthy();
    expect(url, "og:image has to be absolute for a scraper").toMatch(/^https?:/);

    // Fetched rather than trusted: the tag can point at a route that 404s.
    const image = await fetchByPath(page, url!);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");

    expect(await contentOf(page, 'meta[property="og:image:width"]')).toBe(
      "1200",
    );
    expect(await contentOf(page, 'meta[property="og:image:alt"]')).toBeTruthy();
  });

  for (const landing of LANDING_PAGES) {
    test(`/${landing.slug} has a card of its own`, async ({ page }) => {
      await page.goto(`/${landing.slug}`);

      const url = await contentOf(page, 'meta[property="og:image"]');
      expect(url).toBeTruthy();
      // The point of six pages is that they answer six different searches;
      // one shared generic card would undo that at the moment of sharing.
      expect(url).toContain(landing.slug);

      const image = await fetchByPath(page, url!);
      expect(image.status()).toBe(200);

      // Named, so a screen reader on whatever posted it says which card.
      expect(await contentOf(page, 'meta[property="og:image:alt"]')).toContain(
        landing.headline,
      );
    });
  }

  test("the tab icon and the touch icon both resolve", async ({ page }) => {
    await page.goto("/");

    for (const selector of [
      'link[rel="icon"]',
      'link[rel="apple-touch-icon"]',
    ]) {
      const href = await page.locator(selector).getAttribute("href");
      expect(href, `${selector} is missing`).toBeTruthy();
      const response = await page.request.get(href!);
      expect(response.status(), `${selector} does not resolve`).toBe(200);
    }
  });
});
