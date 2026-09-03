import { join } from "node:path";

import { expect, test, type Page, type Route } from "@playwright/test";

import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

/**
 * The rate limit is enforced in the platform's firewall, in front of the
 * application, so nothing here can meet a real one — the suite drives a local
 * server the firewall never sees. `scripts/verify-rate-limit.sh` checks the
 * rule itself against the deployment.
 *
 * What *is* ours, and what these specs cover, is the client's reading of a
 * refusal. The firewall answers before the app is reached, so the action's
 * rejection carries no status and looks exactly like the network being gone.
 * The two call for opposite things from the person holding the file: one means
 * wait a moment, the other means this format needs a connection at all. Which
 * message appears is therefore a behaviour worth pinning down.
 *
 * The refusal is simulated at the request layer, which is the same place the
 * real one happens.
 */

/** The action's own request, told apart from the probe by the header React sends. */
const isAction = (route: Route) =>
  route.request().method() === "POST" &&
  Boolean(route.request().headers()["next-action"]);

const isProbe = (route: Route) =>
  route.request().method() === "POST" && !route.request().headers()["next-action"];

async function openExcel(page: Page) {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("report.xlsx"));
}

test.describe("a refused upload", () => {
  test("says the client is going too fast, not that the server is unreachable", async ({
    page,
  }) => {
    // What the firewall does to every POST from an address over the limit,
    // including the probe that asks whether that is what happened.
    await page.route("**/*", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      return route.fulfill({ status: 403, body: "" });
    });

    await openExcel(page);

    const alert = page.locator('main [role="alert"]');
    await expect(alert).toContainText("Too many files");
    await expect(alert).toContainText("Wait a minute");
    // The wrong message, and the one this exists to prevent: a rate-limited
    // user told their connection is at fault will go looking at their wifi.
    await expect(alert).not.toContainText("couldn't reach the server");
  });

  /**
   * The other half, and the reason the probe reads a status rather than
   * assuming. A failure that is *not* a refusal must keep the message it had:
   * a person offline with a spreadsheet needs to know the format needs a
   * server, not to be told to wait a minute for something that will never
   * come.
   */
  test("still blames the connection when the connection is the problem", async ({
    page,
  }) => {
    await page.route("**/*", async (route) => {
      if (isAction(route)) return route.abort("internetdisconnected");
      // A page path answers 405 to an ordinary POST, because it is not an
      // endpoint. That is the "not refused" answer the probe reads.
      if (isProbe(route)) return route.fulfill({ status: 405, body: "" });
      return route.continue();
    });

    await openExcel(page);

    const alert = page.locator('main [role="alert"]');
    await expect(alert).toContainText("couldn't reach the server");
    await expect(alert).not.toContainText("Too many files");
  });

  /**
   * The probe is a request, and a request can fail. When it does — offline,
   * DNS gone — the honest reading is that nothing answered, which is the
   * connection message rather than a guess at a limit.
   */
  test("falls back to the connection message when nothing answers at all", async ({
    page,
  }) => {
    await page.route("**/*", async (route) => {
      if (route.request().method() === "POST")
        return route.abort("internetdisconnected");
      return route.continue();
    });

    await openExcel(page);

    await expect(page.locator('main [role="alert"]')).toContainText(
      "couldn't reach the server",
    );
  });

  /**
   * The cost of the probe, asserted so it stays this small. It runs only after
   * an upload has already failed, and exactly once — a probe per retry is
   * fine, a probe that loops would be spending the very budget the user is
   * being asked to wait for.
   */
  test("asks once, and only after a failure", async ({ page }) => {
    let probes = 0;
    await page.route("**/*", async (route) => {
      if (isAction(route)) return route.fulfill({ status: 403, body: "" });
      if (isProbe(route)) {
        probes += 1;
        return route.fulfill({ status: 403, body: "" });
      }
      return route.continue();
    });

    await openExcel(page);
    await expect(page.locator('main [role="alert"]')).toContainText(
      "Too many files",
    );
    expect(probes).toBe(1);
  });

  /** A file that never touches the network cannot be refused by an edge rule. */
  test("a browser-parsed file is unaffected", async ({ page }) => {
    let posts = 0;
    await page.route("**/*", async (route) => {
      if (route.request().method() === "POST") {
        posts += 1;
        return route.fulfill({ status: 403, body: "" });
      }
      return route.continue();
    });

    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("sales.csv"));

    await expect(page.getByText("Marmara")).toBeVisible();
    expect(posts).toBe(0);
  });
});
