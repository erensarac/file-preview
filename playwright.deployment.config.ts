import { defineConfig, devices } from "@playwright/test";

/**
 * The suite that runs against the *deployment* rather than a local build.
 *
 * Separate from `playwright.config.ts` on purpose. That one builds the app and
 * starts a server, which is exactly what must not happen here: the whole point
 * is to exercise the code as the platform actually runs it — traced files,
 * serverless functions, cold instances — none of which a local `next start`
 * reproduces.
 *
 * It lives in its own directory too, so `npm test` cannot pick it up and start
 * sending files at production.
 */
const baseURL = process.env.DEPLOYMENT_URL;
if (!baseURL) {
  throw new Error("DEPLOYMENT_URL must be set to run the deployment checks");
}

export default defineConfig({
  testDir: "./tests-deployment",
  globalSetup: "./tests-deployment/global-setup.ts",
  // One at a time. These send real uploads at a real deployment behind a
  // rate-limit rule; parallel workers would measure the queue rather than the
  // work, and could trip the limit that another check exists to verify.
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    launchOptions: process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  // A serverless cold start plus a 3 MB parse is not a five-second operation.
  timeout: 120_000,
  expect: { timeout: 60_000 },
});
