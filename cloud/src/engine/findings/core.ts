/**
 * Findings core — the STORE-AGNOSTIC primitives shared by every store's rule set
 * (iOS `auditFindings.ts`, Android `play/playFindings.ts`). Lifted verbatim out
 * of the iOS findings engine so both stores sort, weight, summarize, and lock on
 * ONE source of truth — the iOS output is unchanged (the existing
 * `auditFindings.spec.ts` still passes byte-for-byte).
 *
 * Pure + deterministic: no fetch / Date.now / randomness — same input → identical
 * output. The per-surface RULES are store-specific and live in each store's
 * module; only the framework lives here.
 */

export type FindingSeverity = "critical" | "warn" | "good" | "info";
export type FindingImpact = "ranking" | "conversion" | "trust" | "completeness";

/**
 * An in-product tool a finding can hand off to (#324 Tier 2) — a builder that
 * already exists in ShipASO, so "you should test this" becomes "here's the
 * treatment to test". Open-ended by design; the client maps it to a section.
 */
export type FindingTool = "screenshots" | "cpp";

/**
 * #324: the ACTION attached to a finding whose fix would otherwise read as
 * "→ do X in App Store Connect" — homework rather than an action.
 *
 * `url` is ALWAYS present and always on Apple's console host, but it is not
 * always precise: `appScoped` says whether we landed the customer on their own
 * app's page or could only reach the generic console. That flag exists because
 * Apple doesn't document the console's routes, so a verified app-scoped path is
 * something we can only sometimes offer — and we say which it is rather than
 * implying a precision we don't have.
 *
 * `tool` is present only where ShipASO genuinely has a builder for this finding.
 * Absent means no handoff exists — never a wrong one.
 */
export type FindingAction = {
  /** where to go in App Store Connect. Generic console URL when unscoped. */
  url: string;
  /** link text, server-authored so the UI never invents a claim. */
  label: string;
  /** true = the link lands on THIS app's page; false = generic console. */
  appScoped: boolean;
  /** an existing ShipASO builder that continues this finding, when one exists. */
  tool?: FindingTool | undefined;
};

export type Finding = {
  /** stable id, e.g. "privacy_policy_missing" */
  id: string;
  /** the surface it came from, e.g. "appInfo" | "previews" | "screenshots" */
  surface: string;
  severity: FindingSeverity;
  impact: FindingImpact;
  /** short, human ("No app preview video") */
  title: string;
  /** why it matters, plain language, 1–2 sentences */
  detail: string;
  /** the concrete action to take */
  fix: string;
  /** the data point, when it sharpens the point */
  evidence?: string | undefined;
  /**
   * #71-C: true marks a STATUS/CONTEXT finding (live version state, pricing
   * context, confirmed category…) — facts that frame the audit but are not
   * recommended fixes. Clients render these in a separate "Listing status"
   * strip so they never dilute the actionable list. Absent = actionable.
   */
  context?: true | undefined;
  /**
   * #324: where to actually DO this — an ASC deep link, and an in-product tool
   * handoff when one exists. Absent on findings with no fix (nothing to act on).
   */
  action?: FindingAction | undefined;
};

/**
 * A surface a run could NOT read — rendered as an honest inline 🔒 "unlock to
 * see + improve" lock (#61). The label states a CAPABILITY gap ("we can't see
 * this without access"), never a deficiency; `unlockCopy` frames the opportunity
 * behind the lock. `surface` is an open string so each store names its own
 * surfaces (iOS subtitle/keywords/…, Play short-description/long-description/…).
 */
export type SurfaceLock = {
  surface: string;
  /** honest one-liner: "we can't SEE this without access" — never a deficiency. */
  label: string;
  /** opportunity framing behind the lock: "unlock to read + improve". */
  unlockCopy: string;
};

export type FindingsSummary = {
  critical: number;
  warn: number;
  good: number;
  info: number;
  total: number;
  /** the impact lane of the highest-weighted finding, or null when there are none. */
  topImpact: FindingImpact | null;
  /**
   * Human one-liner for the audit-card header and dashboard badge, e.g.
   * "3 fixes available · 1 critical" or "No fixes found". A "fix" is an
   * actionable finding (critical + warn); info/good context is never counted,
   * so the header never inflates urgency. This is the source of truth for the
   * format — `public/mock.js` mirrors it byte-for-byte.
   */
  label: string;
};

// ── Scoring ──────────────────────────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = {
  critical: 1000,
  warn: 400,
  info: 100,
  good: 10,
};

/**
 * Impact tiebreak weight. Within an equal severity, a blocker beats a
 * nice-to-have: completeness/trust > conversion > ranking.
 */
const IMPACT_WEIGHT: Record<FindingImpact, number> = {
  completeness: 4,
  trust: 4,
  conversion: 2,
  ranking: 1,
};

/**
 * The sort weight for a finding. Severity dominates; impact is a sub-order added
 * in (scaled below the smallest severity gap so it never reorders severities).
 */
export function scoreFinding(severity: FindingSeverity, impact: FindingImpact): number {
  return SEVERITY_WEIGHT[severity] + IMPACT_WEIGHT[impact];
}

/** Counts + top impact lane for the dashboard badge (PRD 04) and card header. */
export function summarizeFindings(findings: Finding[]): FindingsSummary {
  const summary: FindingsSummary = {
    critical: 0,
    warn: 0,
    good: 0,
    info: 0,
    total: findings.length,
    topImpact: null,
    label: "",
  };
  let topWeight = -1;
  for (const f of findings) {
    summary[f.severity] += 1;
    const w = scoreFinding(f.severity, f.impact);
    if (w > topWeight) {
      topWeight = w;
      summary.topImpact = f.impact;
    }
  }
  summary.label = findingsLabel(summary.critical, summary.warn);
  return summary;
}

/**
 * The audit-card / badge one-liner. "Fixes" = critical + warn (actionable);
 * info/good context never counts. Pure — no time/random. Mirrored in
 * `public/mock.js`; keep the two byte-identical.
 */
export function findingsLabel(critical: number, warn: number): string {
  const fixes = critical + warn;
  const parts: string[] = [];
  if (fixes > 0) parts.push(`${fixes} fix${fixes === 1 ? "" : "es"} available`);
  if (critical > 0) parts.push(`${critical} critical`);
  return parts.length ? parts.join(" · ") : "No fixes found";
}

// ── Rule helpers ─────────────────────────────────────────────────────────────

/** A finding builder with `evidence` only attached when defined (exactOptional). */
export function mk(
  f: Omit<Finding, "evidence" | "context" | "action"> & {
    evidence?: string | undefined;
    context?: true | undefined;
    action?: FindingAction | undefined;
  },
): Finding {
  const out: Finding = {
    id: f.id,
    surface: f.surface,
    severity: f.severity,
    impact: f.impact,
    title: f.title,
    detail: f.detail,
    fix: f.fix,
  };
  if (f.evidence !== undefined) out.evidence = f.evidence;
  if (f.context !== undefined) out.context = f.context;
  if (f.action !== undefined) out.action = f.action;
  return out;
}

/** Stable sort by weight desc, then impact weight desc, then id asc. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const wa = scoreFinding(a.severity, a.impact);
    const wb = scoreFinding(b.severity, b.impact);
    if (wa !== wb) return wb - wa;
    const ia = IMPACT_WEIGHT[a.impact];
    const ib = IMPACT_WEIGHT[b.impact];
    if (ia !== ib) return ib - ia;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
