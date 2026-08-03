import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * The iOS app must not sell through the WEB.
 *
 * App Review rejected 0.1.0 under Guideline 3.1.1 (submission a64749cd,
 * 2026-07-29): "The app accesses digital content purchased outside the app,
 * such as plans, but that content isn't available to purchase using In-App
 * Purchase." The trigger was `portfolio.tsx` opening a Stripe checkout URL in
 * a browser — paid digital content sold outside IAP.
 *
 * The interim fix was to sell nothing at all: name the tier, point at
 * shipaso.com, offer no purchase. Guideline 3.1.3(b) permits that.
 *
 * **That premise is now reversed.** The app sells through native In-App
 * Purchase (RevenueCat, #427), and `<TierGate>` mounts the paywall on the 402
 * screens. Selling in-app is what Apple asked for; it is not the violation.
 *
 * What remains forbidden is the path that was actually cited — steering the
 * user OUT of the app to buy:
 *
 *   • `billingCheckout()`     mints a Stripe checkout URL
 *   • `openBrowserAsync(url)` opens it in the system browser
 *   • `ExternalPurchaseLink`  needs an entitlement we never requested
 *
 * So this guard narrowed rather than disappeared. The rejected mechanism is
 * still a build failure; the native one is now expected.
 *
 * Note the matcher strips comments before testing. The screens that used to
 * sell on the web now carry comments EXPLAINING which paths stay forbidden,
 * and matching raw source flagged those explanations as violations — a false
 * positive that cost a green build the first time this was rewritten.
 */
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

const listFiles = (dir) =>
  execFileSync("git", ["ls-files", dir], { encoding: "utf8", cwd: repoRoot })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));

/** Every shipped iOS source file (tests excluded — they may assert absence). */
const IOS_SOURCES = [...listFiles("mobile/app"), ...listFiles("mobile/src")];

/**
 * Ways to steer a user out of the app to buy. `billingCheckout` mints the
 * Stripe URL; the browser openers are how it would reach the user;
 * `ExternalPurchaseLink` is the entitlement path we never requested. Any one of
 * them is the 3.1.1 violation that was actually cited.
 */
const WEB_PURCHASE_CALLS = [
  { re: /\bbillingCheckout\s*\(/, what: "billingCheckout() — mints a Stripe checkout URL" },
  { re: /openBrowserAsync\s*\(\s*url/, what: "openBrowserAsync(url) on a checkout URL" },
  { re: /\bExternalPurchaseLink\b/, what: "ExternalPurchaseLink (needs an entitlement we did not request)" },
];

/** Source with comments removed — a rule NAMED in prose is not a rule BROKEN. */
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

test("no iOS screen sends the user to the web to buy (Guideline 3.1.1)", () => {
  const offenders = [];
  for (const file of IOS_SOURCES) {
    const src = codeOf(file);
    for (const { re, what } of WEB_PURCHASE_CALLS) {
      if (re.test(src)) offenders.push(`${file}: ${what}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these iOS sources open a WEB purchase path:\n  ${offenders.join("\n  ")}\n\nGuideline 3.1.1 forbids selling digital content outside In-App Purchase. Selling in-app is fine and is what the app now does — mount <TierGate>, which renders the native RevenueCat paywall. What must never come back is steering the user to a browser to pay.`,
  );
});

/**
 * The positive half. Removing the web checkout is only half the fix — a 402
 * screen that offers no way forward is a dead end, and the reason the paywall
 * exists is to be reachable. This asserts the gated screens actually mount it,
 * so "compliant" cannot be achieved by quietly deleting the upgrade path.
 */
test("the tier-gated screens offer the native upgrade", () => {
  const gated = ["mobile/app/(app)/portfolio.tsx", "mobile/app/(app)/war-room/[id].tsx"];
  for (const file of gated) {
    assert.match(
      codeOf(file),
      /<TierGate\b/,
      `${file} has a 402 state but does not mount <TierGate> — the user is told they need a higher tier with no way to get it. Native IAP is permitted; use it.`,
    );
  }
});

/**
 * The endpoint may still exist — the WEB dashboard uses it. What must not
 * happen is the mobile client re-exporting it, which is how a screen would
 * reach it again.
 */
test("the mobile API surface does not expose a checkout call", () => {
  const endpoints = read("mobile/src/api/endpoints.ts");
  assert.doesNotMatch(
    endpoints,
    /export\s+const\s+billingCheckout\b/,
    "mobile/src/api/endpoints.ts still exports billingCheckout — remove it so no screen can reach a purchase flow. The web dashboard keeps its own copy.",
  );
});

/**
 * Mounting the paywall must not remove the EXPLANATION. A screen that shows a
 * bare purchase sheet with no context is worse than one that says which tier is
 * needed and why — and Guideline 3.1.2(c) requires the user to know what they
 * are buying before they buy it.
 *
 * The old assertion here demanded "managed at shipaso.com". That was correct
 * while the app sold nothing; with IAP live, telling a user to go to the web to
 * pay is the steering 3.1.1 objects to. It is deliberately gone.
 */
test("a tier-gated screen still names the tier it requires", () => {
  assert.match(
    codeOf("mobile/app/(app)/portfolio.tsx"),
    /requires="scale"/,
    "the portfolio 402 state must name the tier it requires — a bare paywall tells the user nothing about why they hit it",
  );
});

/**
 * With IAP live, pointing at the web to pay is the violation rather than the
 * fix. This is the inverse of an assertion that used to REQUIRE that copy.
 */
test("no gated screen tells the user to buy on the web", () => {
  const gated = ["mobile/app/(app)/portfolio.tsx", "mobile/app/(app)/war-room/[id].tsx"];
  for (const file of gated) {
    assert.doesNotMatch(
      codeOf(file),
      /managed at shipaso\.com|shipaso\.com\/pricing/i,
      `${file} still sends the user to the web to manage or buy a plan. That was correct when the app sold nothing; now that it sells via IAP, steering out of the app is the 3.1.1 problem.`,
    );
  }
});
