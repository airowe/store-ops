import { defineConfig, devices } from "@playwright/test";

/**
 * E2E for the TanStack redesign (the live app). Serves the built `dist/` with an
 * SPA fallback (tests-e2e/serve.mjs) and drives it against a Playwright-routed
 * mock backend (tests-e2e/mocks.ts) — no live Worker/D1/network. Distinct from
 * cloud/playwright.config.ts, which covers the legacy public/ dashboard.
 * Run: `npm run build && npx playwright test -c playwright.config.ts` from cloud/web.
 */
const PORT = 8794;

export default defineConfig({
  testDir: "./tests-e2e",
  // Every *.e2e.ts EXCEPT prodSmoke, which targets live production and has its
  // own config (playwright.prod.config.ts). Without the exclusion this suite
  // picks it up and runs internet-dependent assertions against the local mock
  // server — so a production outage would surface as a mysteriously red PR.
  testMatch: /.*\.e2e\.ts/,
  testIgnore: /prodSmoke\.e2e\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Pin the theme: since #362 an unset preference follows the OS, so
        // without this the suite renders whichever theme the host prefers.
        colorScheme: "dark",
        // In CI, Playwright uses its own managed browser. In a sandbox where the
        // pinned build isn't downloaded, point PW_EXECUTABLE_PATH at a
        // pre-installed Chromium (e.g. /opt/pw-browsers/chromium-*/chrome-linux/chrome).
        ...(process.env.PW_EXECUTABLE_PATH
          ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } }
          : {}),
      },
    },
  ],
  webServer: {
    command: `node tests-e2e/serve.mjs`,
    env: { PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
