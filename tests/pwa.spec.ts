import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { FORMATS } from "@/lib/formats";
import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

async function manifest(page: Page) {
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href, "no manifest is linked").toBeTruthy();
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe("the manifest", () => {
  test("declares what an installer needs", async ({ page }) => {
    await page.goto("/");
    const declared = await manifest(page);

    expect(declared.name).toBeTruthy();
    expect(declared.short_name).toBeTruthy();
    expect(declared.start_url).toBe("/");
    expect(declared.display).toBe("standalone");

    // An installer refuses without these two sizes, and a manifest that
    // names an icon which 404s fails in exactly the same way as none at all.
    const sizes = declared.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");

    // Android crops an installed icon to the launcher's shape; without a
    // maskable one it gets letterboxed onto a white tile.
    expect(
      declared.icons.some(
        (icon: { purpose?: string }) => icon.purpose === "maskable",
      ),
      "no maskable icon",
    ).toBe(true);

    for (const icon of declared.icons) {
      const response = await page.request.get(icon.src);
      expect(response.status(), `${icon.src} does not resolve`).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/png");
    }
  });

  /**
   * The point of deriving this from the registry is that adding a format
   * registers it with the operating system too. A hand-written list would
   * drift silently — nothing else in the app reads it, so nothing else breaks.
   */
  test("registers every format the registry knows", async ({ page }) => {
    await page.goto("/");
    const declared = await manifest(page);

    const accept: Record<string, string[]> = declared.file_handlers[0].accept;
    const registered = new Set(Object.values(accept).flat());

    for (const format of FORMATS) {
      for (const extension of format.extensions) {
        expect(
          registered.has(`.${extension}`),
          `.${extension} is not registered as a file handler`,
        ).toBe(true);
      }
      for (const mime of format.mimeTypes) {
        expect(accept[mime], `${mime} is not registered`).toBeTruthy();
      }
    }
  });
});

/**
 * Offline.
 *
 * Not a nicety here: every format except Excel and Word is parsed in the tab
 * and never uploaded, so there is no round-trip to lose. What was missing was
 * the shell, which is all the worker supplies.
 */
test.describe("with no connection", () => {
  /**
   * Both steps matter. The first visit is not controlled by the worker — it
   * installs during that load — so nothing from it reaches the cache. The
   * reload is the visit that populates it, which is also why offline works
   * from the second visit and not the first.
   */
  async function warmUp(page: Page) {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready);
  }

  test("a second visit loads and still opens a file", async ({
    page,
    context,
  }) => {
    await warmUp(page);

    // Parsers are loaded on demand, so the CSV parser's chunk only reaches
    // the cache once a CSV has actually been opened.
    await page.setInputFiles('input[type="file"]', fixture("sales.csv"));
    await expect(page.getByText("Marmara")).toBeVisible();

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole("heading", { name: "file" })).toBeVisible();
    await page.setInputFiles('input[type="file"]', fixture("sales.csv"));
    await expect(page.getByText("Marmara")).toBeVisible();
    await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  });

  test("Excel says the connection is the reason, not the file", async ({
    page,
    context,
  }) => {
    await warmUp(page);
    await context.setOffline(true);
    await page.reload();

    await page.setInputFiles('input[type="file"]', fixture("report.xlsx"));

    // The generic parser message ("Failed to fetch", as CI first saw) reads as
    // the app being broken, when in fact everything except Excel and Word
    // still works.
    const alert = page.locator('main [role="alert"]');
    await expect(alert).toContainText("couldn't reach the server");
    await expect(alert).toContainText("no connection");
  });
});

/**
 * The cache holds our own assets and nothing derived from a user's file. The
 * privacy split is the product; a cache quietly retaining document content
 * would break it in the least visible way possible.
 */
test("the worker caches no file content", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);

  // An Excel file is the strongest case: it is the one thing that genuinely
  // crosses the network, as a POST to the server action.
  await page.setInputFiles('input[type="file"]', fixture("report.xlsx"));
  await expect(page.getByText("February")).toBeVisible();

  const audit = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries: { url: string; body: string }[] = [];

    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        const type = response?.headers.get("content-type") ?? "";
        // Only text-ish responses can be read for content; a bitmap or a font
        // could not carry a spreadsheet cell anyway.
        const body =
          response && /text|json|javascript/.test(type)
            ? (await response.text()).slice(0, 200_000)
            : "";
        entries.push({ url: request.url, body });
      }
    }

    return { names, entries, origin: location.origin };
  });

  expect(audit.entries.length, "the cache is empty, so this proves nothing")
    .toBeGreaterThan(0);

  for (const entry of audit.entries) {
    expect(entry.url.startsWith(audit.origin), `${entry.url} is not ours`).toBe(
      true,
    );
    // "February" is a cell in the fixture. If a conversion response were ever
    // cached, this is where it would show up.
    expect(
      entry.body.includes("February"),
      `${entry.url} contains spreadsheet contents`,
    ).toBe(false);
  }
});

/**
 * A file handed over by the operating system, because the app is installed and
 * registered as a handler for that type.
 *
 * `launchQueue` cannot be triggered from a test the way an OS triggers it, so
 * the consumer the app registers is captured and then called directly. That
 * exercises the app's own code path — the handle it receives, the `getFile()`
 * it awaits, and the routing into `open` — rather than asserting that an
 * effect merely ran.
 *
 * The obvious way to capture it does not work, and fails *silently*: Chromium
 * already defines `window.launchQueue` as a read-only own property, so
 * assigning a fake over it is a no-op with no error thrown. The app then talks
 * to the real `LaunchQueue`, which never fires because the page was not
 * launched as a file handler, and the test sees nothing. Shadowing the method
 * on the instance is what actually intercepts it.
 */
test("opens a file handed over by the operating system", async ({ page }) => {
  await page.addInitScript(() => {
    const queue = (window as unknown as { launchQueue?: { setConsumer: unknown } })
      .launchQueue;
    if (!queue) throw new Error("no launchQueue to intercept");

    queue.setConsumer = (consumer: unknown) => {
      (window as unknown as { __consumer: unknown }).__consumer = consumer;
    };
  });

  await page.goto("/");

  await expect
    .poll(() =>
      page.evaluate(
        () => typeof (window as unknown as { __consumer?: unknown }).__consumer,
      ),
    )
    .toBe("function");

  await page.evaluate(async () => {
    const file = new File(
      ["Region,Rep\nMarmara,Ayşe\n"],
      "handed-over.csv",
      { type: "text/csv" },
    );
    const consumer = (
      window as unknown as {
        __consumer: (params: { files: unknown[] }) => Promise<void>;
      }
    ).__consumer;
    await consumer({ files: [{ getFile: async () => file }] });
  });

  await expect(page.getByText("handed-over.csv")).toBeVisible();
  await expect(page.getByText("Marmara")).toBeVisible();
});
