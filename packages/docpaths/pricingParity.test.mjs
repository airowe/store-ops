import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * The agent-readable pricing surfaces must agree with the page a human sees.
 *
 * docs/landing/pricing.md and llms.txt exist so an LLM can quote our pricing
 * without parsing marketing HTML. That creates a SECOND source of truth, and a
 * second source of truth drifts — which is the exact failure this repo spent a
 * whole session cleaning up (docs describing surfaces that had moved).
 *
 * The honest fix is not "remember to update both". It is this test: the prices
 * in the machine-readable files must appear in index.html, or the build fails.
 * A price we quote to an agent but no longer charge is worse than no
 * machine-readable pricing at all — it is a wrong number stated confidently,
 * which is the one thing this product refuses to do anywhere else.
 */
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const read = (p) => readFileSync(join(repoRoot, "docs/landing", p), "utf8");
const html = read("index.html");
const md = read("pricing.md");
const llms = read("llms.txt");

/** Every price token the machine-readable files assert, e.g. "$49". */
function pricesIn(text) {
  return [...new Set([...text.matchAll(/\$[0-9][0-9,]*/g)].map((m) => m[0]))];
}

test("every price in pricing.md also appears on the human pricing page", () => {
  for (const price of pricesIn(md)) {
    assert.ok(
      html.includes(price),
      `pricing.md quotes ${price} but index.html does not contain it — one of the two is stale`,
    );
  }
});

test("every price in llms.txt also appears on the human pricing page", () => {
  for (const price of pricesIn(llms)) {
    assert.ok(
      html.includes(price),
      `llms.txt quotes ${price} but index.html does not contain it — one of the two is stale`,
    );
  }
});

test("the two machine-readable files agree with each other", () => {
  const a = pricesIn(md).sort();
  const b = pricesIn(llms).sort();
  assert.deepEqual(b, a, "llms.txt and pricing.md quote different prices");
});

/**
 * The plan names are the ones the BILLING CODE knows (#380): billing.ts gates
 * on free/indie/startup/scale, and checkoutRoute rejects anything else. The
 * marketing site previously advertised "Launch Optimization", "Autopilot" and
 * "Fleet Autopilot" — names no code path could sell.
 */
test("each named plan appears in all three surfaces", () => {
  for (const plan of ["Indie", "Startup", "Scale"]) {
    assert.ok(html.includes(plan), `index.html is missing the plan "${plan}"`);
    assert.ok(md.includes(plan), `pricing.md is missing the plan "${plan}"`);
    assert.ok(llms.includes(plan), `llms.txt is missing the plan "${plan}"`);
  }
});

/**
 * The product's central claim. If marketing copy ever softens into "ShipASO
 * updates your listing automatically", the machine-readable files would teach
 * that to every agent that reads them. Pin the correction explicitly.
 */
/**
 * THE GUARD THAT WAS MISSING (#380).
 *
 * The three checks above only pin the marketing files to EACH OTHER, so all
 * three drifted together: the site advertised $49/$19/$149 with plan names no
 * code path could sell, while billing.ts charged $7/$19/$65. Quoting $149 for a
 * $65 product survived because nothing compared marketing to the code that
 * takes the money.
 *
 * billing.ts is the authority — it gates real features (appLimitForTier,
 * canRunCron) and its tier names are what checkoutRoute accepts. So the tier
 * names we advertise must be the tier names that exist.
 */
test("every advertised plan name is a tier the billing code actually knows", () => {
  // The Tier union lives in d1.ts; billing.ts imports it and gates on it.
  const d1 = readFileSync(join(repoRoot, "cloud/src/d1.ts"), "utf8");
  const union = d1.match(/export type Tier\s*=\s*([^;]+);/);
  assert.ok(union, "cloud/src/d1.ts should export a Tier union");
  const tiers = [...union[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(tiers.length >= 3, `expected several tiers, got ${tiers.join(", ")}`);

  // Read the plan names from the TABLE ROWS, not from anywhere in the prose.
  // First attempt checked "does 'Scale' appear in the file", which passed even
  // after the Scale row was renamed to "Fleet Autopilot" — because a bullet
  // further down still said the word "Scale". A guard that a mutation walks
  // straight past is not a guard.
  const rowNames = [...md.matchAll(/^\|\s*([A-Z][A-Za-z ]*?)\s*\|/gm)]
    .map((m) => m[1].trim())
    .filter((n) => n !== "Plan");
  assert.ok(rowNames.length >= 3, `expected plan rows in pricing.md, got ${rowNames.join(", ")}`);

  for (const plan of rowNames) {
    assert.ok(
      tiers.includes(plan.toLowerCase()),
      `pricing.md advertises the plan "${plan}", which is not a tier in ` +
        `cloud/src/d1.ts (${tiers.join(", ")}) — checkoutRoute would reject it`,
    );
  }
  // and every real paid tier must actually be advertised, so one can't go missing
  for (const tier of tiers) {
    assert.ok(
      rowNames.some((n) => n.toLowerCase() === tier),
      `billing has a "${tier}" tier that pricing.md does not advertise`,
    );
  }
});

/**
 * The prices themselves. billing.ts records each tier's price in the comment
 * beside its Stripe env key (`indie: { envKey: … }, // $7/mo`), which is the
 * closest thing to a machine-checkable price in the code — the real amounts
 * live in Stripe. Weak, but it catches the $149-vs-$65 class of error.
 */
test("the prices we advertise match the prices recorded in billing.ts", () => {
  const billing = readFileSync(join(repoRoot, "cloud/src/billing.ts"), "utf8");
  const codePrices = new Set([...billing.matchAll(/\$([0-9][0-9,]*)\/mo/g)].map((m) => `$${m[1]}`));
  const advertised = pricesIn(md).filter((p) => p !== "$0"); // free has no Stripe price
  for (const price of advertised) {
    assert.ok(
      codePrices.has(price),
      `pricing.md advertises ${price}, which billing.ts does not list ` +
        `(${[...codePrices].join(", ")}) — one of them is wrong, and the code is the one that bills`,
    );
  }
});

test("llms.txt states the approval boundary, so an agent cannot mis-summarize it", () => {
  assert.match(llms, /does \*\*not\*\* auto-publish|never publishes/i);
  assert.match(llms, /approval/i);
});

test("llms.txt states that we report no keyword volume or difficulty", () => {
  // We measure neither, and competitors publish estimates for both — so an
  // agent summarizing us must not infer that we do. The file has to say so.
  const disclaims =
    /(deliberately no keyword|does not report keyword search volume|no keyword volume)/i;
  assert.match(llms, disclaims);
  // and it must never assert the opposite
  assert.doesNotMatch(llms, /we (provide|report|show) keyword (search )?volume/i);
});
