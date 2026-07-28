import { defineConfig, devices } from "@playwright/test";

/**
 * Post-deploy checks against LIVE production. Deliberately separate from
 * playwright.config.ts, which builds `dist/`, starts a local server and routes
 * every request to a mock backend — none of which may happen here. The whole
 * value of this suite is that nothing is stubbed: no webServer, no mocks, no
 * baseURL pointing at localhost.
 *
 * Run: npx playwright test -c playwright.prod.config.ts
 *   DASHBOARD_URL  override the target (default https://app.shipaso.com)
 *
 * Retries are set because this crosses the public internet and a transient DNS
 * or TLS blip must not open a bogus outage issue. Two retries is the most that
 * still fails fast on a REAL outage, which does not recover between attempts.
 */
export default defineConfig({
  testDir: "./tests-e2e",
  testMatch: /prodSmoke\.e2e\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 2,
  reporter: [["list"]],
  use: {
    trace: "on-first-retry",
    // No baseURL: the spec builds absolute URLs from DASHBOARD_URL so there is
    // no way to accidentally point this suite at a local server.
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Match the mocked suite: since #362 an unset preference follows the OS,
        // and the stylesheet assertion reads a computed background colour.
        colorScheme: "dark",
        ...(process.env.PW_EXECUTABLE_PATH
          ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } }
          : {}),
      },
    },
  ],
});
