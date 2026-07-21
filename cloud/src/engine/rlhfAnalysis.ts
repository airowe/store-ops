/**
 * RLHF Phase 2 analysis (#96) — PURE, offline mining of the anonymized
 * edit-delta corpus exported by `GET /admin/preference-data` (JSONL of
 * `{field, decision, edited, proposed, final, created_at}`, no user/app id).
 *
 * Two outputs, both correlational-descriptive only (no LLM, no network, no D1):
 *   • analyzeEditPatterns — per-field edit rate, signed length drift, keyword
 *     churn, rejection rate — each carrying its sample size,
 *   • acceptanceMetric — the before/after edit-rate delta that is the EVIDENCE
 *     BAR any "learns from your edits" claim must clear first.
 *
 * The honesty fence, made structural:
 *   • every stat carries n; a field/window under MIN_SAMPLE is `sufficient:false`
 *     and carries no strong wording — never a pattern claimed off thin data,
 *   • the metric only reports whether edit rate MOVED; it never attributes the
 *     move to any intervention (there may be none yet — the harness exists so a
 *     future reviewed prompt tweak becomes measurable),
 *   • empty input → empty report; no fabricated stat, ever.
 *
 * Runs in the fast node vitest env: it consumes already-decrypted plaintext rows
 * (decryption happens in the trusted export step), so it never touches the key.
 */

/** The minimum rows before a stat is reported as a real signal (issue's open
 *  question: "don't claim it off a handful of rows"). */
export const MIN_SAMPLE = 30;

/** One exported preference row — mirrors the /admin/preference-data JSONL shape. */
export type PreferenceRow = {
  field: string; // name|subtitle|keywords|promo|description|whatsNew
  decision: "approved" | "rejected";
  edited: boolean;
  proposed: string;
  final: string;
  created_at: string; // "YYYY-MM-DD HH:MM:SS" (SQLite datetime('now'))
};

export type FieldPattern = {
  field: string;
  sampleSize: number;
  /** fraction of rows the human edited (0..1). */
  editRate: number;
  /** mean signed len(final) - len(proposed) over EDITED rows (0 if none edited). */
  lengthDrift: number;
  /** keyword-field only: mean terms added / removed over edited rows. */
  keywordChurn?: { added: number; removed: number };
  /** fraction of rows with decision === "rejected". */
  rejectionRate: number;
  /** false when sampleSize < MIN_SAMPLE — read stats as directional, not claims. */
  sufficient: boolean;
};

export type EditPatternReport = {
  totalRows: number;
  fields: FieldPattern[];
};

/**
 * Parse the export JSONL tolerantly: skip blank/garbage lines (counted, never
 * throwing) and coerce each valid object into a PreferenceRow with safe defaults.
 * A row missing the required text fields is skipped — never a fabricated row.
 */
export function parseJsonl(text: string): { rows: PreferenceRow[]; skipped: number } {
  const rows: PreferenceRow[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o: unknown;
    try {
      o = JSON.parse(t);
    } catch {
      skipped++;
      continue;
    }
    const rec = o as Record<string, unknown>;
    if (rec && typeof rec.field === "string" && typeof rec.proposed === "string" && typeof rec.final === "string") {
      rows.push({
        field: rec.field,
        decision: rec.decision === "rejected" ? "rejected" : "approved",
        edited: !!rec.edited,
        proposed: rec.proposed,
        final: rec.final,
        created_at: typeof rec.created_at === "string" ? rec.created_at : "",
      });
    } else {
      skipped++;
    }
  }
  return { rows, skipped };
}

const terms = (v: string): string[] =>
  v.toLowerCase().split(",").map((t) => t.trim()).filter(Boolean);

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Per-field descriptive stats over the corpus. Fields appear in first-seen order. */
export function analyzeEditPatterns(rows: PreferenceRow[]): EditPatternReport {
  const order: string[] = [];
  const byField = new Map<string, PreferenceRow[]>();
  for (const r of rows) {
    if (!byField.has(r.field)) {
      byField.set(r.field, []);
      order.push(r.field);
    }
    byField.get(r.field)!.push(r);
  }

  const fields: FieldPattern[] = order.map((field) => {
    const fr = byField.get(field)!;
    const edited = fr.filter((r) => r.edited);
    const rejected = fr.filter((r) => r.decision === "rejected");
    const lengthDrift = mean(edited.map((r) => r.final.length - r.proposed.length));

    const pattern: FieldPattern = {
      field,
      sampleSize: fr.length,
      editRate: fr.length ? edited.length / fr.length : 0,
      lengthDrift,
      rejectionRate: fr.length ? rejected.length / fr.length : 0,
      sufficient: fr.length >= MIN_SAMPLE,
    };

    if (field === "keywords" && edited.length) {
      const added = mean(
        edited.map((r) => {
          const before = new Set(terms(r.proposed));
          return terms(r.final).filter((t) => !before.has(t)).length;
        }),
      );
      const removed = mean(
        edited.map((r) => {
          const after = new Set(terms(r.final));
          return terms(r.proposed).filter((t) => !after.has(t)).length;
        }),
      );
      pattern.keywordChurn = { added, removed };
    }

    return pattern;
  });

  return { totalRows: rows.length, fields };
}

// ── acceptance metric ────────────────────────────────────────────────────────

export type WindowStat = {
  before: number; // edit rate in the before window
  after: number; // edit rate in the after window
  deltaPct: number; // after - before (negative = edited LESS = improved)
  direction: "improved" | "worse" | "flat" | "insufficient";
  sampleBefore: number;
  sampleAfter: number;
};

export type AcceptanceMetricReport = {
  cutoff: string;
  overall: WindowStat;
  byField: Array<{ field: string } & WindowStat>;
};

/** A change smaller than this (absolute edit-rate delta) reads as "flat". */
const FLAT_EPS = 0.02;

function windowStat(before: PreferenceRow[], after: PreferenceRow[]): WindowStat {
  const rate = (rs: PreferenceRow[]) => (rs.length ? rs.filter((r) => r.edited).length / rs.length : 0);
  const b = rate(before);
  const a = rate(after);
  const delta = a - b;
  let direction: WindowStat["direction"];
  if (before.length < MIN_SAMPLE || after.length < MIN_SAMPLE) direction = "insufficient";
  else if (Math.abs(delta) < FLAT_EPS) direction = "flat";
  else direction = delta < 0 ? "improved" : "worse";
  return { before: b, after: a, deltaPct: delta, direction, sampleBefore: before.length, sampleAfter: after.length };
}

/**
 * The before/after edit-rate metric. Split by `opts.cutoff` (an ISO date / a
 * created_at prefix), else by the MEDIAN created_at. Reports overall + per-field.
 * Purely descriptive: it says whether proposals got edited LESS after the cutoff,
 * never why. `insufficient` whenever a window is too thin to read.
 */
export function acceptanceMetric(
  rows: PreferenceRow[],
  opts: { cutoff?: string } = {},
): AcceptanceMetricReport {
  const sorted = [...rows].sort((x, y) => (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : 0));
  const cutoff = opts.cutoff ?? (sorted.length ? sorted[Math.floor(sorted.length / 2)]!.created_at : "");

  const before = rows.filter((r) => r.created_at < cutoff);
  const after = rows.filter((r) => r.created_at >= cutoff);

  const fieldNames: string[] = [];
  for (const r of rows) if (!fieldNames.includes(r.field)) fieldNames.push(r.field);

  return {
    cutoff,
    overall: windowStat(before, after),
    byField: fieldNames.map((field) => ({
      field,
      ...windowStat(before.filter((r) => r.field === field), after.filter((r) => r.field === field)),
    })),
  };
}
