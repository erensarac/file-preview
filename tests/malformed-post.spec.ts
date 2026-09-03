import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { FIXTURE_DIR } from "./fixtures";

/**
 * A POST that looks like a server action but is not one.
 *
 * The framework decodes a `multipart/form-data` POST to a page path as an
 * action submission. With no action to find it threw, and the answer was a
 * **500** — the server claiming it broke over a request that was simply
 * malformed. Anyone could provoke it with one `curl`, which made the failure
 * log added for observability something a stranger could fill with noise.
 *
 * `middleware.ts` refuses these before the framework tries. What follows pins
 * down both halves: the malformed shapes are refused, and the genuine one —
 * identical in method, path and content type — still goes through.
 */

const MULTIPART = "multipart/form-data; boundary=----x";
const BODY = Buffer.from(
  '------x\r\nContent-Disposition: form-data; name="file"; ' +
    'filename="t.xlsx"\r\n\r\nx\r\n------x--\r\n',
);

test.describe("a POST shaped like an action but carrying none", () => {
  for (const path of ["/", "/excel-viewer"]) {
    test(`is refused with a 4xx at ${path}`, async ({ request }) => {
      const response = await request.post(path, {
        headers: { "content-type": MULTIPART },
        data: BODY,
      });

      // The specific status matters less than which class it is in: a
      // malformed request is the caller's mistake, and 5xx says it was ours.
      expect(response.status()).toBe(405);
      expect(response.status()).toBeLessThan(500);
      expect(response.headers()["allow"]).toContain("GET");
    });
  }

  /**
   * The bug was not limited to real pages — the same request to a path that
   * does not exist also produced 500, because decoding happened before routing
   * had a chance to say "no such page".
   */
  test("is refused at a path that does not exist either", async ({
    request,
  }) => {
    const response = await request.post("/no-such-page", {
      headers: { "content-type": MULTIPART },
      data: BODY,
    });
    expect(response.status()).toBeLessThan(500);
  });

  /**
   * The other malformed content types were already answered correctly, and
   * this is here so the fix cannot change them on its way past.
   */
  test("leaves the content types that were already correct alone", async ({
    request,
  }) => {
    const plain = await request.post("/", {
      headers: { "content-type": "text/plain;charset=UTF-8" },
      data: "[{}]",
    });
    expect(plain.status()).toBe(405);
  });

  /** A GET is not a POST, whatever content type it claims to carry. */
  test("does not touch a GET", async ({ request }) => {
    const response = await request.get("/", {
      headers: { "content-type": MULTIPART },
    });
    expect(response.status()).toBe(200);
  });
});

/**
 * The half that matters more. A refusal keyed on request shape is one edit
 * away from refusing the shape we depend on — a real upload is the *same*
 * method, the *same* path and the *same* content type, differing only by the
 * action header the framework attaches.
 */
test("a real upload is unaffected", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles(
    'input[type="file"]',
    join(FIXTURE_DIR, "report.xlsx"),
  );

  // Reaching the parsed contents means the POST was not refused on its way in.
  await expect(page.getByText("96200")).toBeVisible();
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
});
