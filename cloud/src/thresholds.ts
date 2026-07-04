/**
 * Run-threshold configuration (#53) — what the weekly sweep is allowed to open
 * an `awaiting_approval` run for. Shared by the API (read/write routes), D1
 * (persistence), and the cron (evaluateThreshold), so the shape and defaults
 * have exactly one home.
 *
 * FAIL-OPEN DESIGN (the comms-prefs precedent): a missing row, NULL, or
 * unparseable JSON must resolve to DEFAULT_THRESHOLDS — which is byte-for-byte
 * today's behavior — so shipping this changes nothing for existing users until
 * they touch a control.
 *
 * Honesty note: thresholds gate what OPENS A RUN (what nags the human). They
 * never change what the agent measures — snapshots are recorded every sweep
 * regardless.
 */

export type ThresholdConfig = {
  /** open when a targeted keyword is unranked (today's trigger). */
  unranked: boolean;
  /** open when a watched competitor's visible listing changed / appeared (today's trigger). */
  competitorChanges: boolean;
  /**
   * open when a keyword's rank WORSENED by ≥ N places week-over-week.
   * null = off (the default — this trigger didn't exist before #53).
   */
  rankDropAtLeast: number | null;
  /** keywords that never trigger (lowercased match). */
  mutedKeywords: string[];
  /** competitor keys/names that never trigger (lowercased match). */
  mutedCompetitors: string[];
  /**
   * true → threshold crossings are REPORTED (digest/push copy) but no run is
   * opened. The agent still measures everything.
   */
  notifyOnly: boolean;
};

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  unranked: true,
  competitorChanges: true,
  rankDropAtLeast: null,
  mutedKeywords: [],
  mutedCompetitors: [],
  notifyOnly: false,
};

/** Clamp for rankDropAtLeast — a drop threshold outside this range is nonsense. */
const DROP_MIN = 1;
const DROP_MAX = 200;

function cleanStringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return null;
    const t = item.trim().toLowerCase();
    if (t) out.push(t);
  }
  return [...new Set(out)].slice(0, 50);
}

/**
 * Parse a stored JSON string into a full config, coercing every field through
 * the defaults. NEVER throws — any garbage (bad JSON, wrong types) falls back
 * per-field (or wholesale) to the default, honoring fail-open.
 */
export function parseThresholds(json: string | null | undefined): ThresholdConfig {
  if (!json) return { ...DEFAULT_THRESHOLDS };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_THRESHOLDS };
  const r = raw as Record<string, unknown>;
  const drop = r.rankDropAtLeast;
  return {
    unranked: typeof r.unranked === "boolean" ? r.unranked : DEFAULT_THRESHOLDS.unranked,
    competitorChanges:
      typeof r.competitorChanges === "boolean"
        ? r.competitorChanges
        : DEFAULT_THRESHOLDS.competitorChanges,
    rankDropAtLeast:
      typeof drop === "number" && Number.isInteger(drop) && drop >= DROP_MIN && drop <= DROP_MAX
        ? drop
        : null,
    mutedKeywords: cleanStringList(r.mutedKeywords) ?? [],
    mutedCompetitors: cleanStringList(r.mutedCompetitors) ?? [],
    notifyOnly: typeof r.notifyOnly === "boolean" ? r.notifyOnly : DEFAULT_THRESHOLDS.notifyOnly,
  };
}

/**
 * Validate a PARTIAL update from the API. Unlike parseThresholds (fail-open on
 * stored data), user input fails LOUD: an invalid field returns an error string
 * so a typo can't silently become a default. Returns the patch on success.
 */
export function validateThresholdPatch(
  body: unknown,
): { ok: true; patch: Partial<ThresholdConfig> } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const r = body as Record<string, unknown>;
  const patch: Partial<ThresholdConfig> = {};
  const KEYS = new Set([
    "unranked",
    "competitorChanges",
    "rankDropAtLeast",
    "mutedKeywords",
    "mutedCompetitors",
    "notifyOnly",
  ]);
  const unknown = Object.keys(r).find((k) => !KEYS.has(k));
  if (unknown) return { ok: false, error: `unknown field: ${unknown}` };

  for (const k of ["unranked", "competitorChanges", "notifyOnly"] as const) {
    if (k in r) {
      if (typeof r[k] !== "boolean") return { ok: false, error: `${k} must be a boolean` };
      patch[k] = r[k] as boolean;
    }
  }
  if ("rankDropAtLeast" in r) {
    const v = r.rankDropAtLeast;
    if (v === null) patch.rankDropAtLeast = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= DROP_MIN && v <= DROP_MAX) {
      patch.rankDropAtLeast = v;
    } else {
      return { ok: false, error: `rankDropAtLeast must be null or an integer ${DROP_MIN}–${DROP_MAX}` };
    }
  }
  for (const k of ["mutedKeywords", "mutedCompetitors"] as const) {
    if (k in r) {
      const list = cleanStringList(r[k]);
      if (list === null) return { ok: false, error: `${k} must be an array of strings` };
      patch[k] = list;
    }
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "empty patch" };
  return { ok: true, patch };
}
