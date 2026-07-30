import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * The iOS app must not sell anything.
 *
 * App Review rejected 0.1.0 under Guideline 3.1.1 (submission a64749cd,
 * 2026-07-29): "The app accesses digital content purchased outside the app,
 * such as plans, but that content isn't available to purchase using In-App
 * Purchase." The trigger was `portfolio.tsx` opening a Stripe checkout URL in
 * a browser — paid digital content sold outside IAP.
 *
 * Apple gave two ways to comply: implement IAP, or use the US External
 * Purchase Link entitlement. We took the third, which Apple also permits and
 * which costs nothing: SELL NOTHING IN THE APP. Guideline 3.1.3(b) allows an
 * app to access content acquired elsewhere so long as it does not offer the
 * purchase itself. Users subscribe on the web; the app reads their tier.
 *
 * That keeps Stripe as the single source of truth for billing. Adding IAP —
 * directly or via RevenueCat — would mean two subscription systems for one
 * account, needing reconciliation for refunds, cancellations, and users who
 * somehow hold both. Not worth it before a single iOS user exists.
 *
 * This guard exists because the violating call was ONE line in ONE screen, and
 * the natural instinct when a 402 comes back is to add an upgrade button right
 * there. That instinct is what got rejected.
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
 * Ways to open a purchase. `billingCheckout` is the API call that mints a
 * Stripe checkout URL; the browser openers are how that URL would reach the
 * user. Either alone is the 3.1.1 violation.
 */
const PURCHASE_CALLS = [
  { re: /\bbillingCheckout\s*\(/, what: "billingCheckout() — mints a Stripe checkout URL" },
  { re: /openBrowserAsync\s*\(\s*url/, what: "openBrowserAsync(url) on a checkout URL" },
  { re: /\bExternalPurchaseLink\b/, what: "ExternalPurchaseLink (needs an entitlement we did not request)" },
];

test("no iOS screen opens a purchase flow (Guideline 3.1.1)", () => {
  const offenders = [];
  for (const file of IOS_SOURCES) {
    const src = read(file);
    for (const { re, what } of PURCHASE_CALLS) {
      if (re.test(src)) offenders.push(`${file}: ${what}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these iOS sources open a purchase path:\n  ${offenders.join("\n  ")}\n\nGuideline 3.1.1 forbids selling digital content outside In-App Purchase. The app is deliberately read-only for billing: users subscribe on the web and the app reads their tier. If you need to sell in-app, that is an IAP/RevenueCat project, not a button.`,
  );
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
 * Removing the button must not remove the EXPLANATION. A tier-gated screen
 * that just fails is worse than one that says what the tier is and where to
 * change it — and "manage your plan on the web" is exactly what Apple's
 * reader-app carve-out contemplates.
 */
test("a tier-gated screen still explains the gate", () => {
  // Comments stripped first: the note at the top of portfolio.tsx explains the
  // 3.1.1 decision and necessarily says "Scale", so matching raw source would
  // pass on the COMMENT after the UI text was removed. Mutation testing caught
  // exactly that.
  const src = read("mobile/app/(app)/portfolio.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.match(
    src,
    /Scale/,
    "the portfolio 402 state must still name the tier it requires — a bare failure tells the user nothing",
  );
  assert.match(
    src,
    /managed at shipaso\.com/i,
    "the screen must say WHERE plans are managed — naming the place is allowed under 3.1.3(b); it is offering to sell that is not",
  );
});
