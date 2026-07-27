import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { extractPaths, lintDocs, missingPathsIn } from "./docPaths.mjs";

/** A throwaway repo with the given files, for filesystem-touching cases. */
function fakeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "docpaths-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

test("extracts repo paths that carry a file extension", () => {
  const found = extractPaths("see cloud/src/api/index.ts and packages/honesty/delta.mjs");
  assert.deepEqual(found.sort(), ["cloud/src/api/index.ts", "packages/honesty/delta.mjs"]);
});

/**
 * Each skip below exists because reporting it would be a FALSE POSITIVE, and a
 * linter that cries wolf gets ignored — which is worse than not having one.
 */
test("skips URLs, globs, placeholders, and bare directories", () => {
  assert.deepEqual(extractPaths("https://x.com/cloud/src/fake.ts"), [], "URL");
  assert.deepEqual(extractPaths("matches cloud/web/src/**"), [], "glob");
  assert.deepEqual(extractPaths("GET cloud/apps/:id/runs.json"), [], "placeholder");
  assert.deepEqual(extractPaths("live in cloud/web/public/"), [], "bare directory");
  assert.deepEqual(extractPaths("run npm ci in cloud/"), [], "bare root");
});

test("ignores paths outside the known repo roots", () => {
  // an Apple API route and an npm package both look path-ish; neither is ours
  assert.deepEqual(extractPaths("v1/appStoreVersions/foo.json"), []);
  assert.deepEqual(extractPaths("node_modules/typescript/lib/tsc.js"), []);
});

test("trailing punctuation is stripped, so prose does not create phantom paths", () => {
  assert.deepEqual(extractPaths("edit cloud/src/index.ts, then deploy."), ["cloud/src/index.ts"]);
  assert.deepEqual(extractPaths("(see packages/api/types.ts)"), ["packages/api/types.ts"]);
});

test("reports only the paths that are actually absent", () => {
  const root = fakeRepo({
    "cloud/src/real.ts": "export {}",
    "docs/guide.md": "real: cloud/src/real.ts · gone: cloud/src/deleted.ts",
  });
  assert.deepEqual(missingPathsIn(root, "docs/guide.md"), ["cloud/src/deleted.ts"]);
});

/**
 * Real false positives from the first run against this repo: cloud/docs/*.md
 * and cloud/migrations/README.md write `scripts/verify-asa-popularity.mts`
 * meaning cloud/scripts/…. Reporting those would have made the linter's very
 * first output 27% noise, which is how a check earns its way onto the ignore
 * list.
 */
test("resolves a path relative to the doc's own WORKSPACE, not just the root", () => {
  const root = fakeRepo({
    "cloud/scripts/tool.mts": "//",
    "cloud/docs/OPS.md": "run scripts/tool.mts",
  });
  assert.deepEqual(missingPathsIn(root, "cloud/docs/OPS.md"), []);
});

test("resolves a sibling reference from the doc's own directory", () => {
  const root = fakeRepo({
    "docs/design/notes.md": "see docs/design/other.md",
    "docs/design/other.md": "#",
  });
  assert.deepEqual(missingPathsIn(root, "docs/design/notes.md"), []);
});

test("still reports a path that resolves under NEITHER reading", () => {
  const root = fakeRepo({ "cloud/docs/OPS.md": "run scripts/ghost.mts" });
  assert.deepEqual(missingPathsIn(root, "cloud/docs/OPS.md"), ["scripts/ghost.mts"]);
});

/**
 * The regression this linter was built for. The pre-push README kept naming
 * cloud/public/** and cloud/tests/e2e/** for weeks after #356 Phase 3 deleted
 * both — the hook itself was correct, only its documentation lied. This is that
 * exact drift, reduced to a fixture.
 */
test("catches the #356 drift: a doc naming a deleted surface", () => {
  const root = fakeRepo({
    "cloud/web/tests-e2e/happyPath.e2e.ts": "//",
    ".githooks/README.md": "e2e runs when the push touches cloud/tests/e2e/runs.spec.ts",
  });
  const findings = lintDocs(root, [".githooks/README.md"]);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].missing, ["cloud/tests/e2e/runs.spec.ts"]);
});

/**
 * Historical opt-out. A design review NAMES the surface it reviewed; that
 * reference is correct as history. Deleting it to satisfy a linter would
 * falsify the record, so the doc declares itself instead — and does it in prose
 * the reader sees, not a config file they never open.
 */
test("a doc that declares itself historical is exempt", () => {
  const root = fakeRepo({
    "docs/design/old-review.md": "> **Historical (2026-06).**\n\nreviewed cloud/public/styles.css",
  });
  assert.deepEqual(missingPathsIn(root, "docs/design/old-review.md"), []);
});

test("the explicit HTML-comment marker also exempts", () => {
  const root = fakeRepo({
    "docs/notes.md": "<!-- docpaths:historical -->\nsee cloud/public/app.js",
  });
  assert.deepEqual(missingPathsIn(root, "docs/notes.md"), []);
});

test("the marker must be a declaration, not the word appearing in prose", () => {
  const root = fakeRepo({
    "docs/live.md": "This is a historical note about cloud/public/app.js in passing.",
  });
  assert.deepEqual(missingPathsIn(root, "docs/live.md"), ["cloud/public/app.js"]);
});

test("a clean doc set yields no findings", () => {
  const root = fakeRepo({
    "cloud/src/a.ts": "//",
    "docs/ok.md": "see cloud/src/a.ts",
  });
  assert.deepEqual(lintDocs(root, ["docs/ok.md"]), []);
});

test("lintDocs reports every offending doc, not just the first", () => {
  const root = fakeRepo({
    "docs/one.md": "cloud/src/gone-a.ts",
    "docs/two.md": "cloud/src/gone-b.ts",
  });
  assert.equal(lintDocs(root, ["docs/one.md", "docs/two.md"]).length, 2);
});
