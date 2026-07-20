// @ts-nocheck — standalone tsx utility (Node globals); not part of the worker build.
/**
 * rlhf-analyze — the #96 Phase 2 offline analyzer.
 *
 * Reads the anonymized edit-delta JSONL that `GET /admin/preference-data`
 * exports (one `{field, decision, edited, proposed, final, created_at}` per line)
 * and prints (a) per-field edit patterns and (b) the before/after
 * proposal-acceptance metric — the evidence bar any "learns from your edits"
 * claim must clear FIRST.
 *
 * Runs in a TRUSTED env on ALREADY-DECRYPTED plaintext (the token-gated export
 * did the decryption in-Worker). This tool never touches the key, D1, or the
 * network — pure analysis over stdin/file. Nothing here changes agent behavior;
 * any prompt tweak the patterns suggest stays a manual, reviewed step.
 *
 * Usage (from cloud/):
 *   npx wrangler ... > export.jsonl                    # the token-gated export
 *   npx tsx scripts/rlhf-analyze.mts < export.jsonl
 *   npx tsx scripts/rlhf-analyze.mts --file export.jsonl --cutoff 2026-07-01
 */
import { readFileSync } from "node:fs";
import {
  analyzeEditPatterns,
  acceptanceMetric,
  parseJsonl,
  MIN_SAMPLE,
} from "../src/engine/rlhfAnalysis.js";

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readInput(): string {
  const file = argVal("--file");
  if (file) return readFileSync(file, "utf8");
  return readFileSync(0, "utf8"); // stdin
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const drift = (x: number) => (x >= 0 ? `+${x.toFixed(1)}` : x.toFixed(1));

function main(): number {
  const { rows, skipped } = parseJsonl(readInput());
  if (skipped) console.log(`(skipped ${skipped} unparseable line(s))`);

  if (!rows.length) {
    console.log("No preference rows — nothing to analyze yet.");
    return 0;
  }

  const patterns = analyzeEditPatterns(rows);
  const metric = acceptanceMetric(rows, argVal("--cutoff") ? { cutoff: argVal("--cutoff")! } : {});

  console.log(`\nRLHF edit-delta analysis — ${patterns.totalRows} rows (min sample for a real signal: ${MIN_SAMPLE})\n`);

  console.log("Per-field patterns:");
  for (const f of patterns.fields) {
    const soft = f.sufficient ? "" : "  ⚠ not enough data yet — read as directional, not a claim";
    let line = `  ${f.field.padEnd(12)} n=${String(f.sampleSize).padStart(4)}  edit ${pct(f.editRate)}  reject ${pct(f.rejectionRate)}  Δlen ${drift(f.lengthDrift)}`;
    if (f.keywordChurn) line += `  kw +${f.keywordChurn.added.toFixed(1)}/-${f.keywordChurn.removed.toFixed(1)}`;
    console.log(line + soft);
  }

  const o = metric.overall;
  console.log(`\nAcceptance metric (before/after ${metric.cutoff}):`);
  if (o.direction === "insufficient") {
    console.log(`  insufficient — need ≥${MIN_SAMPLE} rows each side (before ${o.sampleBefore}, after ${o.sampleAfter}).`);
  } else {
    console.log(
      `  edit rate ${pct(o.before)} → ${pct(o.after)}  (${drift(o.deltaPct * 100)}pp, ${o.direction})` +
        `  [n ${o.sampleBefore}→${o.sampleAfter}]`,
    );
    console.log(
      o.direction === "improved"
        ? "  Proposals were edited LESS after the cutoff. This is the observed change, not proof of cause."
        : o.direction === "worse"
          ? "  Proposals were edited MORE after the cutoff. Observed change only — investigate before acting."
          : "  Edit rate held roughly flat across the cutoff.",
    );
  }

  return 0;
}

// Run only when invoked directly (not when imported by the smoke test).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
