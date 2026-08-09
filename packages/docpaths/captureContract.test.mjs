import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * The capture pipeline is split across two files that must agree without ever
 * importing each other: marketing/screenshots/capture/PLAN.md is the prompt the
 * capture agent follows, .github/workflows/capture-shots.yml is the workflow
 * that deterministically verifies what came back. If the accepted screenshot
 * pixel sizes drift between them, the agent captures at a size the verify step
 * rejects (or worse, the verify step accepts a size the store won't) — this
 * guard pins them to the same set.
 *
 * It also pins the renderer contract: every shot id in the plan's table must be
 * a valid `sourceScreen` filename stem for scripts/render-shipshots.py.
 */
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const planPath = join(repoRoot, "marketing/screenshots/capture/PLAN.md");
const workflowPath = join(repoRoot, ".github/workflows/capture-shots.yml");
const plan = readFileSync(planPath, "utf8");
const workflow = readFileSync(workflowPath, "utf8");

const sizesIn = (text) =>
  [...new Set(text.match(/\b1\d{3}x2\d{3}\b/g) ?? [])].sort();

test("PLAN.md and capture-shots.yml accept the identical pixel sizes", () => {
  const planSizes = sizesIn(plan);
  const workflowSizes = sizesIn(workflow);
  assert.ok(planSizes.length > 0, "PLAN.md must state the accepted sizes");
  assert.deepEqual(
    workflowSizes,
    planSizes,
    "accepted screenshot sizes drifted between the plan and the workflow's verify step",
  );
});

test("every planned shot id is a valid renderer sourceScreen stem", () => {
  // Shot table rows look like: | `audit-result` | ... |
  const ids = [...plan.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 3, `expected a shot table in PLAN.md, found ${ids.length} rows`);
  assert.equal(new Set(ids).size, ids.length, "duplicate shot ids");
  for (const id of ids) {
    assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `shot id "${id}" is not a kebab-case filename stem`);
  }
});

test("the workflow runs the plan it claims to (and both files exist)", () => {
  assert.ok(existsSync(planPath) && existsSync(workflowPath));
  assert.ok(
    workflow.includes("marketing/screenshots/capture/PLAN.md"),
    "capture-shots.yml no longer feeds PLAN.md to the agent",
  );
});
