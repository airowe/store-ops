/**
 * Doc-path linter — fail the build when a tracked document names a repo path
 * that does not exist.
 *
 * WHY THIS EXISTS
 *
 * Documentation goes stale silently. In one week this repo accumulated four
 * separate lies, each written accurately and then outlived by its subject:
 * a hook README naming `cloud/public/**` and port :8793 after both moved
 * (#356), a migration plan still headed "Status: proposal" after it shipped, a
 * wrangler comment describing a deploy of a deleted directory, and a module
 * docstring asserting that shipped files "don't exist yet" (#375).
 *
 * Only ONE of those classes is mechanically detectable — a named path that
 * isn't there — and that is exactly what this checks. It deliberately does not
 * try to verify prose claims about behaviour; a linter that pretends to do that
 * would itself become a thing that lies.
 *
 * WHAT IT WILL NOT DO
 *
 * Never guesses. A token that merely looks path-ish (a URL, a glob, an ASC API
 * route, an npm package) is SKIPPED rather than reported, because a false
 * positive trains people to ignore the check — which is worse than no check.
 * Extraction is conservative on purpose: it reports a subset of real breakage
 * rather than a superset that includes noise.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Directory prefixes that are real top-level areas of this repo. A candidate
 * only counts as a repo path if it starts with one of these — that is what
 * separates `cloud/public/app.js` from `appstoreconnect.apple.com/v1/apps`.
 */
export const REPO_ROOTS = [
  "cloud/",
  "mobile/",
  "packages/",
  "docs/",
  "scripts/",
  "lib/",
  ".github/",
  ".githooks/",
];

/**
 * A doc opts out by declaring itself historical, near the top, in prose a
 * reader benefits from too:
 *   <!-- docpaths:historical -->            (explicit)
 *   > **Historical (2026-06). …**           (a status line the reader sees)
 */
export const HISTORICAL_MARKER =
  /<!--\s*docpaths:historical\s*-->|^>?\s*\*{0,2}Historical\b/im;

/** Extensions we treat as "a file that should exist on disk". */
const FILE_EXT =
  /\.(ts|tsx|mjs|cjs|js|jsx|json|md|css|html|sql|toml|yml|yaml|py|sh|mts|cts)$/;

/**
 * Pull candidate repo paths out of a document.
 *
 * Skipped on purpose, each because reporting it would be noise:
 *   • anything inside a URL (http://…/cloud/foo) — not a local path
 *   • globs (`cloud/web/src/**`, `*.spec.ts`) — a pattern, not a file
 *   • bare directories with no extension — too ambiguous to verify
 *   • paths containing a placeholder (`:id`, `{id}`, `<name>`, `$VAR`)
 */
export function extractPaths(text) {
  const withoutUrls = text.replace(/https?:\/\/\S+/g, " ");
  const out = new Set();
  // A path-ish run of characters: word chars, dots, slashes, dashes.
  for (const m of withoutUrls.matchAll(/[A-Za-z0-9_.\-/]+/g)) {
    const raw = m[0];
    // strip trailing punctuation the regex may have swept up
    const tok = raw.replace(/[.,;:)\]}]+$/, "");
    if (!REPO_ROOTS.some((r) => tok.startsWith(r))) continue;
    if (tok.includes("*")) continue; // glob
    if (/[:{}<>$]/.test(tok)) continue; // placeholder
    if (!FILE_EXT.test(tok)) continue; // bare dir — unverifiable
    out.add(tok);
  }
  return [...out];
}

/**
 * Check one document's paths against the filesystem.
 * Returns the paths it names that do not exist.
 *
 * A path counts as existing if it resolves under ANY reasonable reading:
 *   • from the repo root — `cloud/src/api/index.ts`
 *   • from the doc's own directory — a sibling reference
 *   • from the doc's owning WORKSPACE — cloud/docs/OPS.md writing
 *     `scripts/verify-asa-popularity.mts` means cloud/scripts/…, since docs are
 *     written from the perspective of the workspace you run commands in.
 *
 * Being generous here is deliberate. The linter's job is to catch a path that
 * resolves NOWHERE — a genuinely dead reference. Every ambiguous reading it
 * accepts is a false positive it does not emit, and false positives are what
 * kill a check's credibility.
 */
export function missingPathsIn(repoRoot, docRelPath) {
  const text = readFileSync(join(repoRoot, docRelPath), "utf8");
  // A doc can declare itself a historical record inline. Design reviews and
  // shipped plans NAME the surfaces they were written about; those references
  // are correct as history, and deleting them to satisfy a linter would
  // falsify the record. Opting out in the document itself keeps that decision
  // visible to the next reader, unlike a path buried in the linter's config.
  if (HISTORICAL_MARKER.test(text)) return [];
  const docDir = dirname(docRelPath);
  // the doc's owning workspace: "cloud/docs/OPS.md" → "cloud"
  const workspace = docRelPath.split("/")[0];
  const bases = [".", docDir, workspace];
  const resolvesSomewhere = (p) => bases.some((b) => existsSync(join(repoRoot, b, p)));
  return extractPaths(text).filter((p) => !resolvesSomewhere(p));
}

/**
 * Lint many docs. Returns [{ doc, missing: [...] }] for docs with breakage,
 * so a caller can report every offender at once rather than one per run.
 */
export function lintDocs(repoRoot, docRelPaths) {
  const findings = [];
  for (const doc of docRelPaths) {
    const missing = missingPathsIn(repoRoot, doc);
    if (missing.length) findings.push({ doc, missing });
  }
  return findings;
}
