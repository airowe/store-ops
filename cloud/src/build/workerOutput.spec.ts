/**
 * The GENERATED `_worker.js` is what actually runs in production — assert on it,
 * not just on the pure helpers it embeds.
 *
 * `webEnable.spec.ts` proves `isAssetRequest`/`serveDecision` decide correctly.
 * That is necessary and not sufficient: web-enable.mjs emits the worker as a
 * template string, so a helper can be perfect while the emitted worker never
 * calls it. #393 was exactly that shape one level down — the module docstring
 * claimed "a genuinely missing FILE still 404s as a file", the decision function
 * agreed, and production still answered 200 + index.html for every miss.
 *
 * These read the emitted source rather than run it. Executing the worker needs a
 * Workers runtime with an `env.ASSETS` binding, which `wrangler pages dev`
 * provides — the behaviour itself was verified there (missing → 404 text/plain,
 * real bundle → 200, page path → SPA shell, /auth/m + the Apple association file
 * untouched) and mutation-tested by disabling the branch, which returned the
 * 200 + HTML bug. This suite is the cheap regression net for that work.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cloudRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerPath = resolve(cloudRoot, "dist", "_worker.js");

/**
 * Regenerate rather than trust whatever dist/ happens to hold: a stale worker
 * from an earlier build would make every assertion below meaningless. Requires
 * the app build to have run (web-enable.mjs fails loudly otherwise), so skip
 * cleanly in a checkout with no cloud/web/dist rather than fail spuriously.
 */
const canBuild = existsSync(resolve(cloudRoot, "web", "dist", "index.html"));

const worker = (() => {
  if (!canBuild) return "";
  execFileSync("node", [resolve(cloudRoot, "scripts", "web-enable.mjs")], { cwd: cloudRoot });
  return readFileSync(workerPath, "utf8");
})();

describe.skipIf(!canBuild)("generated _worker.js (#393)", () => {
  it("defines isAssetRequest AND calls it — a helper it never invokes is dead code", () => {
    expect(worker).toMatch(/function isAssetRequest\(/);
    // At least one call site beyond the declaration.
    const calls = worker.match(/isAssetRequest\(/g) ?? [];
    expect(calls.length, "isAssetRequest is defined but never called").toBeGreaterThan(1);
  });

  it("turns an HTML fallback for an asset path into a real 404", () => {
    expect(worker).toMatch(/status:\s*404/);
    // Gated on the response being HTML — a real .js/.css asset must pass through.
    expect(worker).toMatch(/text\/html/);
  });

  /**
   * The 404 must not itself become cacheable. `/assets/* → immutable` is what
   * turned one bad response into #392's multi-hour outage; a cached 404 would
   * be the same trap wearing a different status code.
   */
  it("marks the 404 no-store so it cannot become the next poisoned entry", () => {
    expect(worker).toMatch(/no-store/);
  });

  it("still rewrites navigations to the app shell (the SPA 404 must survive)", () => {
    expect(worker).toMatch(/isNavigationRequest\(/);
    expect(worker).toMatch(/_web/);
  });

  it("still exempts the extensionless static pages", () => {
    // 404ing these would break sign-in by emailed link and iOS universal links.
    expect(worker).toMatch(/\/auth\/m/);
    expect(worker).toMatch(/apple-app-site-association/);
  });
});
