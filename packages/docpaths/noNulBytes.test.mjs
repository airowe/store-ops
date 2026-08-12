/**
 * No NUL bytes in source files (#476 follow-up).
 *
 * A single `\0` makes grep classify an entire file as BINARY and report zero
 * matches — silently. Not an error, not a warning: an empty result set that
 * looks exactly like "this text is not here".
 *
 * That is not hypothetical. `cloud/src/api/index.ts` used one as a composite
 * map key separator (`app_id + NUL + country`), and a search for "delta" in
 * that file returned nothing while the `/deltas` route handler sat at line
 * 3371. The conclusion drawn from that empty result — "the route does not
 * exist in this repo" — was wrong, and was reported as fact.
 *
 * U+001F (UNIT SEPARATOR) does the same job: it is a C0 control character no
 * keyword, country code, or bundle id will ever contain, so composite keys stay
 * collision-safe — and it does not trip binary detection.
 *
 * The ONE allowed exception is a test that deliberately feeds a NUL to a
 * sanitizer. Removing it there would weaken a real test rather than fix a
 * hazard, so it is listed explicitly rather than pattern-matched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Files whose NUL bytes are the test input itself, not a separator. */
const ALLOWED = new Set(["cloud/src/api/runConfig.spec.ts"]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".wrangler",
  "coverage",
  ".next",
]);
const EXTS = [".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx", ".py"];

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // a broken symlink is not a source file
    }
    if (st.isDirectory()) yield* sourceFiles(full);
    else if (EXTS.some((x) => name.endsWith(x))) yield full;
  }
}

test("no source file contains a NUL byte (it makes grep skip the file silently)", () => {
  const offenders = [];
  for (const file of sourceFiles(repoRoot)) {
    const rel = relative(repoRoot, file).split("\\").join("/");
    if (ALLOWED.has(rel)) continue;
    if (readFileSync(file).includes(0)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `these files contain a NUL byte, so grep reports ZERO matches for anything ` +
      `in them: ${offenders.join(", ")}. Use U+001F ("\\u001f") as a composite-key ` +
      `separator instead — same collision-safety, still greppable.`,
  );
});

test("the allow-list only covers files that still exist and still need it", () => {
  // A stale allow-list entry would silently permit a NUL in a file that no
  // longer has one — the guard would then pass while protecting nothing.
  for (const rel of ALLOWED) {
    const buf = readFileSync(join(repoRoot, rel));
    assert.ok(
      buf.includes(0),
      `${rel} is allow-listed for NUL bytes but no longer contains one — drop it from ALLOWED.`,
    );
  }
});
