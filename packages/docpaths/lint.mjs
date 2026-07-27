/**
 * Lint every tracked doc in the repo for paths that no longer exist.
 *
 * Run: node packages/docpaths/lint.mjs   (from the repo root)
 * Exits 1 with a report when a doc names a missing repo path.
 *
 * SCOPE: docs that are meant to describe the CURRENT repo. Historical records
 * are excluded below — a PRD that accurately described the world in April is
 * not "stale", and rewriting it would destroy the record rather than improve
 * it. The distinction is deliberate: this checks documents someone would act
 * on, not documents someone would cite.
 */
import { execFileSync } from "node:child_process";
import { lintDocs } from "./docPaths.mjs";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

/**
 * Historical/archival docs. These are point-in-time records; their references
 * to since-deleted paths are correct AS HISTORY.
 */
const ARCHIVED = [
  /^docs\/prds?\//, // per-issue PRDs — written against the repo of their day
  /^docs\/launch\//, // launch collateral, frozen at launch
  // Dated plan/spec records (docs/superpowers/plans/2026-07-17-*.md). These are
  // "what we intended on that date" — a plan naming a file that was later
  // renamed is accurate as history, and editing it would falsify the record.
  /^docs\/superpowers\/(plans|specs)\//,
  /^CHANGELOG\.md$/,
];

const docs = execFileSync("git", ["ls-files", "*.md"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter((p) => !ARCHIVED.some((re) => re.test(p)));

const findings = lintDocs(repoRoot, docs);

if (findings.length === 0) {
  console.log(`[docpaths] OK: ${docs.length} docs, every named repo path exists`);
  process.exit(0);
}

console.error(`[docpaths] ${findings.length} doc(s) name paths that do not exist:\n`);
for (const { doc, missing } of findings) {
  console.error(`  ${doc}`);
  for (const p of missing) console.error(`    ✗ ${p}`);
}
console.error(
  `\nEither the path moved (update the doc) or the doc is describing something that was deleted.\n` +
    `If the doc is a historical record, add it to ARCHIVED in packages/docpaths/lint.mjs.`,
);
process.exit(1);
