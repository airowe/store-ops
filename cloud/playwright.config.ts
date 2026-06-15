import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the no-build dashboard (public/). Playwright serves the static
 * files and drives the real app.js against the deterministic mock backend
 * (mock.js) — the spec forces mock mode by stubbing config.js, so no live Worker,
 * D1, or network is touched. Tests live in tests/e2e/*.e2e.ts (a distinct glob
 * from vitest's "src/**" spec pattern, so the two runners never collide).
 */
const PORT = 8793;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `python3 -m http.server ${PORT} --directory public`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
