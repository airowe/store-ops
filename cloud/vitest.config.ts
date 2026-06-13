import { defineConfig } from "vitest/config";

// Engine logic is pure TS (no Worker runtime), so the default node environment
// runs the *.spec.ts files fast. When api/ and cron/ need a Worker runtime + D1,
// switch those suites to @cloudflare/vitest-pool-workers (already a devDep).
export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    environment: "node",
  },
});
