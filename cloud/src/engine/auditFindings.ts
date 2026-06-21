/**
 * Findings engine — PRD 01 (`docs/prd/asc-findings/01-findings-engine.md`).
 *
 * A PURE, DETERMINISTIC, NETWORK-FREE function that turns the already-captured
 * ASC snapshot (+ the existing audit/ranks) into a sorted `Finding[]`. Every
 * rule, threshold, severity and copy string lives here (the catalog is PRD 05,
 * `05-surface-findings-spec.md`) so the whole surface is exhaustively
 * unit-testable with ZERO HTTP mocking.
 *
 * HARD CONSTRAINTS (carried from the suite overview):
 *  - No fetch / Date.now / randomness — same input → identical output.
 *  - Graceful: an undefined snapshot or an absent/errored surface emits no
 *    findings for that surface and NEVER throws.
 *  - Don't over-assert: pricing + age-rating findings cap at `warn` (usually
 *    `info`), never `critical` (the #41 trap).
 *  - Derives ONLY from the captured snapshot — it issues no new ASC reads.
 */
import type { AscSnapshot, InAppPurchase } from "./ascRead.js";
import type { Audit } from "./agent.js";
import type { Rank } from "./rankCheck.js";

/**
 * `snapshot.locales` is typed `LiveListingCopy[]` on the snapshot, but the reader
 * (`readAscAllLocales`) actually returns `LocaleListingCopy[]` — each row carries
 * its own `locale` tag. We read that tag here without widening the snapshot type.
 */
type LocaleRow = AscSnapshot["locales"] extends ReadonlyArray<infer T> | undefined
  ? T & { locale?: string | undefined }
  : never;

export type FindingSeverity = "critical" | "warn" | "good" | "info";
export type FindingImpact = "ranking" | "conversion" | "trust" | "completeness";

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
};

/**
 * A surface a run could NOT read — rendered as an honest inline 🔒 "unlock to
 * see + improve" lock (#61). The label states a CAPABILITY gap ("we can't see
 * this without access"), never a deficiency; `unlockCopy` frames the opportunity
 * behind the lock ("connect to read + improve"). The catalog (copy) lives HERE,
 * in the engine, so the UI never re-derives "is this surface readable".
 */
export type SurfaceLock = {
  surface:
    | "subtitle"
    | "keywords"
    | "screenshots"
    | "previews"
    | "privacy"
    | "category"
    | "locales";
  /** honest one-liner: "we can't SEE this without access" — never a deficiency. */
  label: string;
  /** opportunity framing behind the lock: "unlock to read + improve". */
  unlockCopy: string;
};

export type AuditFindingsInput = {
  /** undefined on a no-key run. */
  snapshot?: AscSnapshot | undefined;
  /** existing audit (carries the screenshot ShotScore). */
  audit: Audit;
  /** existing rank data. */
  ranks: Rank[];
  appName: string;
  /** did this run read ASC? drives the unlock CTA finding. */
  hasAscKey: boolean;
  /**
   * surface-read-error finding (`surface_read_error`) is off by default — it's a
   * diagnostic, not a user lever. Flip on for an operator/debug view.
   */
  includeReadErrors?: boolean | undefined;
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
function mk(
  f: Omit<Finding, "evidence"> & { evidence?: string | undefined },
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
  return out;
}

/** ASC "in review / pending" states — metadata is locked while in these. */
const IN_REVIEW_STATES = new Set([
  "IN_REVIEW",
  "WAITING_FOR_REVIEW",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
  "PROCESSING_FOR_APP_STORE",
]);

/** Editable (draft) states — an app with one of these has an editable version. */
const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

/** The most-shown modern iPhone preview/screenshot size token. */
const LARGEST_IPHONE = "APP_IPHONE_67";

/** A preview asset state that isn't a clean COMPLETE — failed or still working. */
function previewIsUnready(state: string): boolean {
  const s = state.toUpperCase();
  return s !== "COMPLETE" && s !== "";
}

// ── Per-surface rule sets ────────────────────────────────────────────────────

/** screenshots — re-uses the existing ShotScore grade on the audit. */
function screenshotFindings(input: AuditFindingsInput): Finding[] {
  const shot = input.audit.screenshots;
  if (!shot) return [];
  const out: Finding[] = [];
  const grade = shot.grade;
  const iphone = shot.iphoneCount;
  const ipad = shot.ipadCount;
  const reliable = grade !== "?";

  if (reliable && (grade === "D" || grade === "F")) {
    out.push(
      mk({
        id: "screenshots_grade_low",
        surface: "screenshots",
        severity: "critical",
        impact: "conversion",
        title: `Screenshots are hurting conversion (grade ${grade})`,
        detail:
          "Weak screenshots cost installs — they're the first thing a shopper judges.",
        fix: "Add 4+ tall-phone screenshots; the first 2–3 carry most installs.",
        evidence: `grade ${grade}`,
      }),
    );
  }

  if (reliable && iphone >= 1 && iphone <= 3) {
    out.push(
      mk({
        id: "screenshots_thin",
        surface: "screenshots",
        severity: "warn",
        impact: "conversion",
        title: `Only ${iphone} screenshot${iphone === 1 ? "" : "s"}`,
        detail: "You're leaving conversion on the table by not filling the slots.",
        fix: "Use more slots; the first 2–3 convert hardest.",
        evidence: `${iphone} iPhone shots`,
      }),
    );
  }

  // Universal app (ships iPad) but no iPad screenshots. We can only tell "ships
  // iPad" from the snapshot's iPad screenshot set existing as a device family
  // with zero usable shots; absent the snapshot we stay quiet (no false claim).
  if (reliable && shipsIpadButEmpty(input.snapshot) && ipad === 0) {
    out.push(
      mk({
        id: "screenshots_no_ipad",
        surface: "screenshots",
        severity: "info",
        impact: "conversion",
        title: "No iPad screenshots",
        detail: "Your iPad store page falls back to stretched iPhone shots.",
        fix: "Add iPad screenshots if you ship iPad.",
      }),
    );
  }

  if (!reliable) {
    out.push(
      mk({
        id: "screenshots_unknown",
        surface: "screenshots",
        severity: "info",
        impact: "conversion",
        title: "Couldn't read screenshots from public data",
        detail:
          "The public iTunes API often omits screenshots, so we can't grade them reliably.",
        fix: "Connect App Store Connect for a real screenshot grade.",
      }),
    );
  }
  return out;
}

/** True only when the snapshot shows an iPad device family present but empty. */
function shipsIpadButEmpty(snapshot: AscSnapshot | undefined): boolean {
  const sets = snapshot?.screenshots?.ipadScreenshots;
  if (!sets || sets.length === 0) return false;
  return sets.every((d) => d.count === 0);
}

/** previews — `snapshot.previews.devices[]`. */
function previewFindings(snapshot: AscSnapshot | undefined): Finding[] {
  const previews = snapshot?.previews;
  if (!previews) return [];
  const out: Finding[] = [];
  const devices = previews.devices ?? [];

  if (devices.length === 0) {
    out.push(
      mk({
        id: "preview_missing",
        surface: "previews",
        severity: "warn",
        impact: "conversion",
        title: "No app preview video",
        detail: "Preview videos lift conversion — they show the app in motion before install.",
        fix: "Add a 15–30s preview for your primary device.",
      }),
    );
    return out; // no devices ⇒ neither coverage nor error checks apply
  }

  const hasLargest = devices.some((d) => d.previewType === LARGEST_IPHONE);
  if (!hasLargest) {
    out.push(
      mk({
        id: "preview_thin_coverage",
        surface: "previews",
        severity: "info",
        impact: "conversion",
        title: "Preview missing on the largest iPhone",
        detail: 'The 6.7" iPhone is the most-shown size on the store.',
        fix: 'Add a 6.7" preview — it\'s the most-shown size.',
      }),
    );
  }

  const unready = devices.find((d) => d.assetState.some((s) => previewIsUnready(s)));
  if (unready) {
    out.push(
      mk({
        id: "preview_error_state",
        surface: "previews",
        severity: "warn",
        impact: "conversion",
        title: "A preview failed to process",
        detail: "A preview that isn't COMPLETE won't show on your store page.",
        fix: "Re-upload it — it won't show until it processes.",
        evidence: unready.previewType,
      }),
    );
  }
  return out;
}

/** appInfo — `snapshot.appInfo`. */
function appInfoFindings(input: AuditFindingsInput): Finding[] {
  const appInfo = input.snapshot?.appInfo;
  if (!appInfo) return [];
  const out: Finding[] = [];
  const primaryLocale = appInfo.locales[0];

  if (primaryLocale && !primaryLocale.privacyPolicyUrl) {
    out.push(
      mk({
        id: "privacy_policy_missing",
        surface: "appInfo",
        severity: "critical",
        impact: "completeness",
        title: "No privacy policy URL",
        detail:
          "Apple can reject a submission without a privacy policy, and it's a baseline trust signal.",
        fix: "Add a privacy policy URL in App Store Connect.",
      }),
    );
  }

  if (!appInfo.secondaryCategory) {
    out.push(
      mk({
        id: "secondary_category_missing",
        surface: "appInfo",
        severity: "warn",
        impact: "ranking",
        title: "No secondary category set",
        detail: "A secondary category is a free second ranking surface you're not using.",
        fix: "Pick your most relevant secondary category in App Store Connect.",
      }),
    );
  }

  if (appInfo.primaryCategory) {
    const name = appInfo.primaryCategory.name ?? appInfo.primaryCategory.id;
    out.push(
      mk({
        id: "primary_category_context",
        surface: "appInfo",
        severity: "info",
        impact: "ranking",
        title: `Category: ${name}`,
        detail: "Your primary category shapes which charts and searches you rank in.",
        fix: "Confirm it matches the keywords you're targeting.",
        evidence: name,
      }),
    );
  }

  // Name set in App Info vs the version localization name — if they disagree,
  // your listing reads inconsistently across layers.
  const appInfoName = primaryLocale?.name?.trim();
  const versionName = primaryVersionName(input);
  if (appInfoName && versionName && appInfoName !== versionName) {
    out.push(
      mk({
        id: "appinfo_name_mismatch",
        surface: "appInfo",
        severity: "info",
        impact: "completeness",
        title: "Your app name differs between listing layers",
        detail: "App Info and the version localization carry different names.",
        fix: "Align them in App Store Connect.",
        evidence: `"${appInfoName}" vs "${versionName}"`,
      }),
    );
  }
  return out;
}

/** The version-localization name from the snapshot's primary locale, if read. */
function primaryVersionName(input: AuditFindingsInput): string | undefined {
  const locales = input.snapshot?.locales;
  const first = locales && locales.length > 0 ? locales[0] : undefined;
  return first?.name?.trim() || undefined;
}

/** versionState — `snapshot.versionState`. */
function versionFindings(snapshot: AscSnapshot | undefined): Finding[] {
  const versionState = snapshot?.versionState;
  if (!versionState) return [];
  const out: Finding[] = [];
  const current = versionState.current;
  const all = versionState.all ?? [];

  if (IN_REVIEW_STATES.has(current.appStoreState)) {
    out.push(
      mk({
        id: "version_in_review",
        surface: "versionState",
        severity: "info",
        impact: "completeness",
        title: "Your app is in review",
        detail: "Metadata is locked while a version is in review.",
        fix: "Ship metadata changes after it clears review.",
        evidence: current.appStoreState,
      }),
    );
  }

  const hasDraft = all.some((v) => EDITABLE_STATES.has(v.appStoreState));
  if (!hasDraft) {
    out.push(
      mk({
        id: "version_no_draft",
        surface: "versionState",
        severity: "info",
        impact: "completeness",
        title: "No draft version",
        detail: "You need an editable version to push metadata changes.",
        fix: "Create a new version in App Store Connect.",
      }),
    );
  }

  out.push(
    mk({
      id: "version_context",
      surface: "versionState",
      severity: "info",
      impact: "completeness",
      title: `Live version ${current.versionString} (${current.appStoreState})`,
      detail: "Current version context for the rest of the audit.",
      fix: "No action — context only.",
      evidence: `${current.versionString} ${current.appStoreState}`,
    }),
  );
  return out;
}

/** pricing + IAPs — `snapshot.pricing`. Low-signal: never above `info`. */
function pricingFindings(snapshot: AscSnapshot | undefined): Finding[] {
  const pricing = snapshot?.pricing;
  if (!pricing) return [];
  const out: Finding[] = [];
  const iaps = pricing.iaps ?? [];

  if (iaps.length > 0 && !iaps.some(isPromotedIap)) {
    out.push(
      mk({
        id: "iap_not_promoted",
        surface: "pricing",
        severity: "info",
        impact: "conversion",
        title: `You have ${iaps.length} in-app purchase${iaps.length === 1 ? "" : "s"}, none promoted`,
        detail:
          "Promoted in-app purchases can surface on your product page and directly in search.",
        fix: "Promote your best IAPs in App Store Connect.",
        evidence: `${iaps.length} IAPs`,
      }),
    );
  }

  // Honest three-state label (#71): 0 ⇒ free; positive ⇒ paid; null/undefined ⇒
  // UNKNOWN — we couldn't read the price, so we must NOT assert "paid" (that was
  // a fabricated-as-measured bug: a free app whose price read failed showed
  // "paid"). Unknown is surfaced as "unknown", never guessed.
  const basePrice = pricing.pricing.baseTerritoryPrice;
  const priceLabel = basePrice === 0 ? "free" : basePrice != null && basePrice > 0 ? "paid" : "unknown price";
  const iapSuffix = iaps.length > 0 ? `, ${iaps.length} IAPs` : "";
  out.push(
    mk({
      id: "pricing_context",
      surface: "pricing",
      severity: "info",
      impact: "conversion",
      title: `${priceLabel}${iapSuffix}`,
      detail: "Pricing context that frames the rest of the conversion advice.",
      fix: "No action — context only.",
      evidence: `${priceLabel}${iapSuffix}`,
    }),
  );
  return out;
}

/** ASC InAppPurchase has no promotion field in the snapshot; treat a `promoted`
 *  flag defensively if a future read adds one. Today this is always false, so
 *  `iap_not_promoted` fires whenever IAPs exist — the intended launch behavior. */
function isPromotedIap(iap: InAppPurchase): boolean {
  return (iap as InAppPurchase & { promoted?: boolean }).promoted === true;
}

/** ageRating — `snapshot.ageRating`. Low-signal: never above `warn`. */
function ageRatingFindings(snapshot: AscSnapshot | undefined): Finding[] {
  const ageRating = snapshot?.ageRating;
  if (!ageRating) return [];
  const out: Finding[] = [];

  if (!ageRating.ageRating) {
    // #71-A3: an empty parsed rating does NOT prove "not declared". We may have
    // read the declaration but failed to parse Apple's value (format drift), or
    // hit a restricted field. Asserting "not declared — can block submission" on
    // a live app is alarming AND almost certainly wrong (a READY_FOR_SALE app
    // necessarily HAS a rating). So we don't claim it's missing — we say plainly
    // that we couldn't confirm it, at info level, never a false blocker warning.
    out.push(
      mk({
        id: "age_rating_unconfirmed",
        surface: "ageRating",
        severity: "info",
        impact: "completeness",
        title: "Age rating not confirmed",
        detail: "We couldn't read a declared age rating from App Store Connect — that may be a read limitation, not a missing rating.",
        fix: "Confirm your age rating is set in App Store Connect (it's required to ship).",
      }),
    );
  } else {
    out.push(
      mk({
        id: "age_rating_context",
        surface: "ageRating",
        severity: "info",
        impact: "completeness",
        title: `Age rating: ${ageRating.ageRating}`,
        detail: "Your declared age rating, for context.",
        fix: "No action — context only.",
        evidence: ageRating.ageRating,
      }),
    );
  }
  return out;
}

/** customProductPages — `snapshot.customProductPages.pages[]`. */
function cppFindings(snapshot: AscSnapshot | undefined): Finding[] {
  const cpp = snapshot?.customProductPages;
  if (!cpp) return [];
  const out: Finding[] = [];
  const pages = cpp.pages ?? [];

  if (pages.length === 0) {
    out.push(
      mk({
        id: "cpp_none",
        surface: "customProductPages",
        severity: "info",
        impact: "conversion",
        title: "No Custom Product Pages",
        detail:
          "Custom Product Pages let you tailor your store page per ad or audience — a growth lever once the basics are solid.",
        fix: "Create a Custom Product Page in App Store Connect.",
      }),
    );
  } else {
    out.push(
      mk({
        id: "cpp_present",
        surface: "customProductPages",
        severity: "good",
        impact: "conversion",
        title: `${pages.length} Custom Product Page${pages.length === 1 ? "" : "s"}`,
        detail: "You're tailoring your store page per audience.",
        fix: "Nice — you're using CPPs.",
        evidence: `${pages.length} pages`,
      }),
    );
  }
  return out;
}

/** locales — `snapshot.locales[]`. */
function localeFindings(snapshot: AscSnapshot | undefined): Finding[] {
  const locales = snapshot?.locales as LocaleRow[] | undefined;
  if (!locales) return [];
  const out: Finding[] = [];

  if (locales.length === 1) {
    out.push(
      mk({
        id: "locale_single",
        surface: "locales",
        severity: "warn",
        impact: "ranking",
        title: "Live in 1 locale",
        detail:
          "Each localization is a new keyword surface and a new audience you're not reaching.",
        fix: "Localize for the top locales in your category.",
        evidence: localeKey(locales[0]),
      }),
    );
  }

  for (const loc of locales) {
    const key = localeKey(loc);
    const subtitle = loc.subtitle?.trim();
    const keywords = loc.keywords?.trim();
    if (!subtitle || !keywords) {
      out.push(
        mk({
          id: "locale_incomplete",
          surface: "locales",
          severity: "warn",
          impact: "ranking",
          title: `${key} localization is incomplete`,
          detail: "Empty subtitle or keyword fields waste ranking surface.",
          fix: "Fill its subtitle and keyword fields in App Store Connect.",
          evidence: key,
        }),
      );
    }
  }
  return out;
}

/** The locale tag of a listing-copy row (the snapshot carries it at runtime). */
function localeKey(loc: LocaleRow | undefined): string {
  return loc?.locale ?? "this locale";
}

/** cross-surface / meta — the no-key unlock CTA + optional read-error notes. */
function metaFindings(input: AuditFindingsInput): Finding[] {
  const out: Finding[] = [];

  if (!input.hasAscKey) {
    out.push(
      mk({
        id: "asc_unlock",
        surface: "meta",
        severity: "info",
        impact: "completeness",
        title: "Unlock your full audit",
        detail:
          "Connect App Store Connect to audit screenshots, preview video, privacy policy, category, and localization gaps.",
        fix: "Connect App Store Connect to unlock your full audit.",
      }),
    );
  }

  if (input.includeReadErrors) {
    for (const err of input.snapshot?.errors ?? []) {
      out.push(
        mk({
          id: "surface_read_error",
          surface: "meta",
          severity: "info",
          impact: "completeness",
          title: `Couldn't read ${err.surface} from App Store Connect`,
          detail: "Your key may lack permission for that surface.",
          fix: "Check your App Store Connect key's role and scopes.",
          evidence: err.surface,
        }),
      );
    }
  }
  return out;
}

// ── Public entrypoint ────────────────────────────────────────────────────────

/**
 * Compute the sorted findings for a run. Pure + deterministic: same input →
 * deep-equal output. Each surface degrades independently — an absent or errored
 * surface contributes nothing rather than throwing.
 *
 * Sort: by severity×impact weight descending (biggest wins first); ties broken
 * by impact weight then stably by id, so the array is fully deterministic.
 */
export function auditFindings(input: AuditFindingsInput): Finding[] {
  const findings: Finding[] = [
    ...screenshotFindings(input),
    ...previewFindings(input.snapshot),
    ...appInfoFindings(input),
    ...versionFindings(input.snapshot),
    ...pricingFindings(input.snapshot),
    ...ageRatingFindings(input.snapshot),
    ...cppFindings(input.snapshot),
    ...localeFindings(input.snapshot),
    ...metaFindings(input),
  ];

  return sortFindings(findings);
}

// ── Locked-field upgrade surface (#61) ───────────────────────────────────────
//
// The canonical no-key blind-spot catalog: each App Store Connect-only surface
// that the public iTunes API can't expose, rendered as an honest inline lock.
// Copy is CAPABILITY + OPPORTUNITY only — it states what we can't SEE and what
// connecting would unlock, NEVER a deficiency ("0/30", "empty", "missing") or
// urgency ("costing you", "losing"). That honesty is enforced as a unit-test
// invariant (#56's "never assert a deficiency in an unseen field").
const NO_KEY_SURFACE_LOCKS: readonly SurfaceLock[] = [
  {
    surface: "subtitle",
    label: "We can't see your subtitle without access",
    unlockCopy: "Connect App Store Connect to read your live subtitle and improve it.",
  },
  {
    surface: "keywords",
    label: "We can't see your keyword field without access",
    unlockCopy: "Connect App Store Connect to read your keyword field and improve it.",
  },
  {
    surface: "screenshots",
    label: "We can't read your real screenshots without access",
    unlockCopy: "Connect App Store Connect to grade your real screenshot set and improve it.",
  },
  {
    surface: "previews",
    label: "We can't see your app preview video without access",
    unlockCopy: "Connect App Store Connect to read your preview coverage and improve it.",
  },
  {
    surface: "privacy",
    label: "We can't see your privacy policy without access",
    unlockCopy: "Connect App Store Connect to read your privacy policy and category and improve them.",
  },
  {
    surface: "category",
    label: "We can't see your full category setup without access",
    unlockCopy: "Connect App Store Connect to read your primary and secondary categories and improve them.",
  },
  {
    surface: "locales",
    label: "We can't see your per-locale keyword surfaces without access",
    unlockCopy: "Connect App Store Connect to read every locale's keyword surface and improve it.",
  },
];

/**
 * The surfaces a run could NOT read — the per-surface data contract behind the
 * inline 🔒 "unlock to see + improve" pattern (#61). A keyed run reads every
 * surface ⇒ locks NOTHING; a no-key run returns the canonical blind-spot list.
 *
 * Pure + deterministic: same input → deep-equal output. Keys off the SAME
 * `hasAscKey` boolean that `asc_unlock` already uses — no new signal invented,
 * and the data (a stray snapshot) never changes the answer: the gap is keyed-ness.
 */
export function surfaceLocks(input: AuditFindingsInput): SurfaceLock[] {
  if (input.hasAscKey) return [];
  // Return fresh clones so callers can't mutate the shared catalog.
  return NO_KEY_SURFACE_LOCKS.map((l) => ({ ...l }));
}

/** Stable sort by weight desc, then impact weight desc, then id asc. */
function sortFindings(findings: Finding[]): Finding[] {
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
