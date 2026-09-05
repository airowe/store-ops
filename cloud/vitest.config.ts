import { defineConfig } from "vitest/config";

// Engine logic is pure TS (no Worker runtime), so the default node environment
// runs the *.spec.ts files fast. When api/ and cron/ need a Worker runtime + D1,
// switch those suites to @cloudflare/vitest-pool-workers (already a devDep).
export default defineConfig({
  test: {
    // scripts/ holds plain-node ESM (the post-deploy smoke test and its
    // helpers); its specs are .mjs so the module under test is the one node
    // actually runs, not a transpiled twin.
    include: ["src/**/*.spec.ts", "scripts/**/*.spec.mjs"],
    environment: "node",
  },
});
