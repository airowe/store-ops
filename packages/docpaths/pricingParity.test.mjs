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

test("each named plan appears in all three surfaces", () => {
  for (const plan of ["Launch Optimization", "Autopilot", "Fleet Autopilot"]) {
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
