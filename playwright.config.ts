import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3210);

/**
 * `CHROMIUM_EXECUTABLE_PATH` lets sandboxed environments point at a Chromium
 * that is already on disk. CI leaves it unset and uses the browser installed by
 * `playwright install`.
 */
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
  // Tests run against a production build: the preview budgets and the
  // client/server split are what's being asserted, and dev-mode behaviour
  // differs enough to make that unreliable.
  webServer: {
    command: `npm run build && npx next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
