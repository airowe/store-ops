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
import { detectDuplicateScreenshots } from "./ascRead.js";
import type { AscSnapshot, InAppPurchase } from "./ascRead.js";
import type { Audit, StorefrontIntel } from "./agent.js";
import type { Rank } from "./rankCheck.js";
import type { ReviewSentiment } from "./reviewSentiment.js";
import { ratingsSignal } from "./ratingsSignal.js";
import { recommendLocalesFromLanguages } from "./languageCoverage.js";
import type { ChartRank } from "./chartRank.js";

/**
 * `snapshot.locales` is typed `LiveListingCopy[]` on the snapshot, but the reader
 * (`readAscAllLocales`) actually returns `LocaleListingCopy[]` — each row carries
 * its own `locale` tag. We read that tag here without widening the snapshot type.
 */
type LocaleRow = AscSnapshot["locales"] extends ReadonlyArray<infer T> | undefined
  ? T & { locale?: string | undefined }
  : never;

// Store-agnostic findings primitives live in `findings/core.ts`. We import the
// ones used internally and RE-EXPORT the public surface so every existing
// importer (index.ts, agent.ts, api, mcp, the spec) keeps importing them here.
import { mk, sortFindings } from "./findings/core.js";
import type { Finding, SurfaceLock } from "./findings/core.js";
import type { CopyFields } from "./optimize.js";
import { reviewRiskFindings } from "./reviewRisk.js";
import { ppoFindings } from "./ppoFindings.js";
import { ppoResultFindings } from "./ppoResults.js";
import { projectGrade, leversAddressedByPlan, gradeProjectionFinding } from "./gradeProjection.js";

/** App Store minimum-strong screenshot set — what a generated Studio set ships. */
const RECOMMENDED_SHOT_COUNT = 6;
import { clusterKeywordIntents } from "./cppIntents.js";
import { cppIdenticalFindings, screenshotSignature } from "./cppScreenshotDiff.js";
export {
  type Finding,
  type FindingImpact,
  type FindingSeverity,
  type FindingsSummary,
  type SurfaceLock,
  scoreFinding,
  summarizeFindings,
  findingsLabel,
} from "./findings/core.js";

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
  /**
   * The run's PROPOSED copy (#178) — linted for review-rejection risk (price in
   * title, unverifiable claims, placeholder text, brand-in-keywords). Undefined
   * (e.g. a run with no proposal) emits no review-risk findings.
   */
  proposedCopy?: CopyFields | undefined;
  /**
   * PUBLIC-review sentiment (#95). Undefined when reviews weren't fetched (or
   * the fetch came back empty) — the `reviews` surface then emits NOTHING, like
   * every other absent surface. When present it carries the honest sample size
   * and a SUPPRESSED score below threshold (#78).
   */
  reviews?: ReviewSentiment | undefined;
  /**
   * PUBLIC storefront-page intel (storefront-intel PRD 01) — carries Apple's
   * own ratings read `{ average, count, histogram }`. Undefined when the page
   * wasn't readable — the `ratings` surface then emits NOTHING, like every
   * other absent surface.
   */
  storefront?: StorefrontIntel | undefined;
  /**
   * PUBLIC category chart rank (analytics-reports PRD 04 map). `ranked:true`
   * carries a MEASURED position; `ranked:false` means we read the chart and the
   * app isn't in the top N; `undefined`/null means the chart was unreadable or
   * the genre unknown — the `chart` surface then emits NOTHING (unknown ≠ zero).
   */
  chartRank?: ChartRank | null | undefined;
};

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

/**
 * #71-B: the run's tracked keywords, in target order — the app-derived material
 * suggestion copy is built from (preview script beats, CPP angles). These are
 * the keywords the run genuinely targeted, never invented terms.
 */
function topKeywords(ranks: Rank[], n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of ranks) {
    const kw = r.keyword?.trim();
    if (!kw || seen.has(kw.toLowerCase())) continue;
    seen.add(kw.toLowerCase());
    out.push(kw);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * #71-B5: closest secondary-category fits DERIVED from the primary category — a
 * deterministic pairing of adjacent App Store categories, so the finding carries
 * a concrete starting suggestion instead of a bare "pick one" link. Honest
 * framing: "closest fits from your primary category", never a demand claim.
 * Unmapped categories keep the generic copy.
 */
const SECONDARY_CATEGORY_FITS: Record<string, string> = {
  FOOD_AND_DRINK: "Health & Fitness or Lifestyle",
  HEALTH_AND_FITNESS: "Lifestyle or Medical",
  PRODUCTIVITY: "Utilities or Business",
  UTILITIES: "Productivity",
  LIFESTYLE: "Health & Fitness",
  FINANCE: "Business or Productivity",
  BUSINESS: "Productivity",
  EDUCATION: "Reference or Productivity",
  REFERENCE: "Education",
  PHOTO_AND_VIDEO: "Graphics & Design",
  GRAPHICS_AND_DESIGN: "Photo & Video",
  MUSIC: "Entertainment",
  ENTERTAINMENT: "Photo & Video",
  MEDICAL: "Health & Fitness",
  SPORTS: "Health & Fitness",
  NEWS: "Magazines & Newspapers",
  MAGAZINES_AND_NEWSPAPERS: "News",
  SHOPPING: "Lifestyle",
  SOCIAL_NETWORKING: "Lifestyle",
  DEVELOPER_TOOLS: "Utilities or Productivity",
  WEATHER: "Utilities",
  NAVIGATION: "Travel",
  TRAVEL: "Navigation or Lifestyle",
  BOOKS: "Education or Reference",
};

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

  // #68: duplicate screenshots — only when the ASC snapshot SUBSTANTIATES it
  // (same source fileName / same asset repeated within ONE device set; cross-
  // size replication never counts). Informational: the grade is untouched until
  // the signal proves reliable in the wild. No snapshot / no fileNames → silent.
  const dups = detectDuplicateScreenshots(input.snapshot?.screenshots);
  if (dups.length > 0) {
    const wasted = dups.reduce((n, g) => n + (g.count - 1), 0);
    const names = dups
      .slice(0, 4)
      .map((g) => `${g.key} ×${g.count}`)
      .join(", ");
    out.push(
      mk({
        id: "screenshots_duplicates",
        surface: "screenshots",
        severity: "info",
        impact: "conversion",
        title: `${wasted} screenshot slot${wasted === 1 ? "" : "s"} spent on repeats`,
        detail:
          "Some screenshots share the same source file. Each shown slot should sell a distinct value prop — repeats cost installs.",
        fix: "Replace the repeated shots with distinct value-prop shots.",
        evidence: `same source: ${names}`,
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

  // #26 Studio: the honest before→after. Project the grade a GENERATED set (a full
  // recommended-count, target-aspect set) would reach — "B → projected A" — so the
  // audit closes the loop instead of stopping at the problem. Null/A/no-headroom →
  // silent (projectGrade + gradeProjectionFinding both no-op there).
  if (shot) {
    const addressed = leversAddressedByPlan(
      { shotCount: RECOMMENDED_SHOT_COUNT, hasIpad: shot.ipadCount > 0, atTargetAspect: true },
      shot,
    );
    const projFinding = gradeProjectionFinding(projectGrade(shot, addressed));
    if (projFinding) out.push(projFinding);
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
function previewFindings(input: AuditFindingsInput): Finding[] {
  const previews = input.snapshot?.previews;
  if (!previews) return [];
  const out: Finding[] = [];
  const devices = previews.devices ?? [];

  if (devices.length === 0) {
    // #71-B4: don't abandon the user at a bare ASC link — script the preview
    // from the run's REAL tracked keywords (never invented terms). Without
    // keywords the generic guidance stands.
    const kws = topKeywords(input.ranks, 3);
    const scripted =
      kws.length > 0
        ? `Script it from your targets: open on the “${kws[0]}” job in the first 3 seconds` +
          (kws.length > 1
            ? `, then one beat each for ${kws
                .slice(1)
                .map((k) => `“${k}”`)
                .join(" and ")}`
            : "") +
          " — 15–30s of real in-app footage, ending on the outcome."
        : "Add a 15–30s preview for your primary device.";
    out.push(
      mk({
        id: "preview_missing",
        surface: "previews",
        severity: "warn",
        impact: "conversion",
        title: "No app preview video",
        detail: "Preview videos lift conversion — they show the app in motion before install.",
        fix: scripted,
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
    // #71-B5: carry a concrete starting suggestion derived from the primary
    // category (deterministic adjacent-category pairing), not a bare "pick one".
    const fits = appInfo.primaryCategory
      ? SECONDARY_CATEGORY_FITS[appInfo.primaryCategory.id]
      : undefined;
    out.push(
      mk({
        id: "secondary_category_missing",
        surface: "appInfo",
        severity: "warn",
        impact: "ranking",
        title: "No secondary category set",
        detail: "A secondary category is a free second ranking surface you're not using.",
        fix: fits
          ? `From your primary category, the closest fits are ${fits} — set one in App Store Connect.`
          : "Pick your most relevant secondary category in App Store Connect.",
      }),
    );
  }

  if (appInfo.primaryCategory) {
    // #71-B7: this is CONFIRMED by the ASC read — phrase it as a confirmed
    // fact, not a "go check" chore. Context, not a fix (#71-C).
    const name = appInfo.primaryCategory.name ?? appInfo.primaryCategory.id;
    out.push(
      mk({
        id: "primary_category_context",
        surface: "appInfo",
        severity: "info",
        impact: "ranking",
        title: `Category confirmed: ${name}`,
        detail:
          "Read from your App Store Connect listing — it shapes which charts and searches you rank in.",
        fix: "No action — confirmed from your listing.",
        evidence: name,
        context: true,
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
        context: true, // #71-C: a state of the world, not a fix
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
        context: true, // #71-C: listing status — shown in the status strip
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
      context: true, // #71-C
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
      context: true, // #71-C
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
        context: true, // #71-C
      }),
    );
  }
  return out;
}

/** customProductPages — `snapshot.customProductPages.pages[]`. */
function cppFindings(input: AuditFindingsInput): Finding[] {
  const cpp = input.snapshot?.customProductPages;
  if (!cpp) return [];
  const out: Finding[] = [];
  const pages = cpp.pages ?? [];

  // #154 Part 1: honest, MEASURED intent count from the run's OWN tracked
  // keywords — CPPs now surface in ORGANIC search, so distinct intents are
  // distinct candidate pages. No keywords → no intent claim (never a fake count).
  const intents = clusterKeywordIntents(input.ranks.map((r) => r.keyword));
  const intentClause = intents.length
    ? ` Your tracked keywords span ${intents.length} distinct intent${intents.length === 1 ? "" : "s"} (${intents
        .slice(0, 3)
        .map((i) => `“${i.label}”`)
        .join(", ")}${intents.length > 3 ? ", …" : ""}) — each is a candidate page.`
    : "";

  if (pages.length === 0) {
    // #71-B6: suggest concrete CPP angles from the run's REAL tracked keywords
    // (one page per intent) instead of a bare "create one" link.
    const kws = topKeywords(input.ranks, 3);
    const angles =
      kws.length > 0
        ? `Angle ideas from your targets: one page per intent — ${kws
            .map((k) => `“${k}”`)
            .join(", ")} — each opening on that job. Create them in App Store Connect.`
        : "Create a Custom Product Page in App Store Connect.";
    out.push(
      mk({
        id: "cpp_none",
        surface: "customProductPages",
        severity: "info",
        impact: "conversion",
        title: "No Custom Product Pages",
        detail:
          "Custom Product Pages let you tailor your store page per audience — and Apple now surfaces them in organic search, not just paid placements, so they're unclaimed ranking surface." +
          intentClause,
        fix: angles,
      }),
    );
  } else {
    // Present: acknowledge the coverage, and honestly flag headroom when tracked
    // intents outnumber the pages that exist (uncovered candidate audiences).
    const uncovered = intents.length - pages.length;
    const headroom =
      uncovered > 0
        ? ` Your tracked keywords span ${intents.length} distinct intents — ${uncovered} more than your ${pages.length} page${pages.length === 1 ? "" : "s"}, so there's room for audiences you're not tailoring to yet.`
        : "";
    out.push(
      mk({
        id: "cpp_present",
        surface: "customProductPages",
        severity: "good",
        impact: "conversion",
        title: `${pages.length} Custom Product Page${pages.length === 1 ? "" : "s"}`,
        detail: "You're tailoring your store page per audience." + headroom,
        fix: uncovered > 0 ? "Consider a page for each uncovered intent." : "Nice — you're using CPPs.",
        evidence: `${pages.length} pages`,
      }),
    );
    // #154: flag any CPP whose screenshots are the SAME assets as the default
    // page (wasted surface). Default signature comes from the run's already-read
    // default screenshots; a CPP with no read signature stays silent.
    const defaultShots = [
      ...(input.snapshot?.screenshots?.iphoneScreenshots ?? []),
      ...(input.snapshot?.screenshots?.ipadScreenshots ?? []),
    ].flatMap((s) => s.screenshots);
    out.push(...cppIdenticalFindings(screenshotSignature(defaultShots), pages));
  }
  return out;
}

/** locales — `snapshot.locales[]`. */
function localeFindings(input: AuditFindingsInput): Finding[] {
  const snapshot = input.snapshot;
  const locales = snapshot?.locales as LocaleRow[] | undefined;
  // Keyless run: no ASC locale list, but the public page may list languages.
  // language_single fires only here, so it can never double up with locale_single.
  if (!locales) return languageFindings(input);
  const out: Finding[] = [];

  if (locales.length === 1) {
    // #71-C: status, not a fix — the actionable per-market recommendations live
    // in the localization-expansion card (PRD 04), which fires on the same read.
    // Keeping this in the fix list double-counted the same lever.
    out.push(
      mk({
        id: "locale_single",
        surface: "locales",
        severity: "info",
        impact: "ranking",
        title: "Live in 1 locale",
        detail:
          "Each localization is a new keyword surface and a new audience you're not reaching.",
        fix: "See the market recommendations below — each is a concrete locale to claim.",
        evidence: localeKey(locales[0]),
        context: true,
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

/**
 * languages — the PUBLIC storefront language list (storefront-intel PRD 03),
 * used only when there's no ASC locale snapshot (keyless runs). Language-level:
 * we say "listed in N languages", never "live in N locales". Absent/unreadable
 * languages ⇒ no finding (unknown, never "EN-only"). The actionable per-market
 * recommendations live in the expansion card (same #71-C no-double-count rule).
 */
function languageFindings(input: AuditFindingsInput): Finding[] {
  const languages = input.storefront?.languages;
  if (!languages || languages.length !== 1) return [];
  const { recommendations } = recommendLocalesFromLanguages({
    languages,
    category: input.storefront?.category,
  });
  // A MEASURED count of a bundled heuristic — large-tier storefronts in other
  // languages the static model ranks. Never a per-market volume claim.
  const largeCount = recommendations.filter((r) => r.storefrontTier === "large").length;
  const detail =
    largeCount > 0
      ? `${largeCount} large storefront${largeCount === 1 ? "" : "s"} in other languages are separate keyword surfaces you haven't claimed.`
      : "Each additional language is a separate keyword surface and audience.";
  return [
    mk({
      id: "language_single",
      surface: "locales",
      severity: "info",
      impact: "ranking",
      title: `Listed in 1 language (${languages[0]})`,
      detail,
      fix: "See the market recommendations below — each is a concrete language to add.",
      evidence: languages[0],
      context: true,
    }),
  ];
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

/**
 * reviews — PUBLIC review sentiment (#95). Low-signal surface: NEVER critical.
 *   • absent (undefined) → no findings (graceful, like every other surface).
 *   • n < threshold (score SUPPRESSED) → an honest "too few reviews" info finding
 *     that carries the sample size and presents NO confident numeric score (#78).
 *   • otherwise → a sentiment-summary finding (info) that surfaces the OBSERVED
 *     top topics; counts are sample frequencies, never extrapolated to "% of users".
 */
function reviewFindings(input: AuditFindingsInput): Finding[] {
  const reviews = input.reviews;
  if (!reviews) return [];
  const out: Finding[] = [];

  // Honest empty-vs-low-vs-confident handling.
  if (reviews.score === null || reviews.confidence === "low") {
    out.push(
      mk({
        id: "reviews_low_sample",
        surface: "reviews",
        severity: "info",
        impact: "trust",
        title: "Too few reviews to summarize sentiment reliably",
        detail:
          "We read the public reviews but the sample is too small to summarize sentiment with confidence — so we don't put a number on it.",
        fix: "Grow your review volume (in-app prompts at the right moment); we'll summarize sentiment once there's enough signal.",
        evidence: `n=${reviews.n}`,
      }),
    );
    return out;
  }

  // n >= threshold: a confident summary + the observed top topics.
  const topTopics = reviews.topics.slice(0, 3);
  const topicList = topTopics.map((t) => `${t.topic} (${t.count}, ${t.sentiment})`).join("; ");
  out.push(
    mk({
      id: "reviews_sentiment_summary",
      surface: "reviews",
      severity: "info",
      impact: "trust",
      title: `Review sentiment: ${reviews.label} (n=${reviews.n})`,
      detail:
        topTopics.length > 0
          ? `Top topics users mention (observed in your ${reviews.n}-review sample): ${topicList}.`
          : `Overall public-review sentiment across ${reviews.n} reviews.`,
      fix: "Use these recurring topics to guide your roadmap and store-listing language.",
      evidence: topicList || `score ${reviews.score}/100`,
    }),
  );
  return out;
}

/**
 * ratings — Apple's own storefront histogram (storefront-intel PRD 01).
 * Low-signal surface like `reviews`: NEVER critical.
 *   • `storefront`/`ratings` absent → no findings (unknown stays absent).
 *   • `histogram: []` (unreadable) → shape is unknown, BOTH findings are
 *     suppressed — we don't editorialize a shape we couldn't read.
 *   • bimodal 1★/5★ split → `ratings_polarized` (warn/trust) with the observed
 *     shares verbatim, labeled with Apple's own count (`n=<count>`), never
 *     blended with the RSS review sample.
 *   • thin count → `ratings_thin` (info/trust, context) — Apple's own "Not
 *     Enough Ratings" stance, a fact that frames the audit, never a
 *     deficiency claim about the app.
 */
function ratingsFindings(input: AuditFindingsInput): Finding[] {
  const signal = ratingsSignal(input.storefront?.ratings);
  // No shares ⇒ the histogram was unreadable — suppress the whole surface
  // rather than assert anything about a shape we didn't measure.
  if (!signal?.shares) return [];
  const out: Finding[] = [];

  if (signal.polarization?.bimodal) {
    const oneStar = Math.round(signal.shares[0] * 100);
    const fiveStar = Math.round(signal.shares[4] * 100);
    const observed = `1★ ${oneStar}% · 5★ ${fiveStar}%`;
    out.push(
      mk({
        id: "ratings_polarized",
        surface: "ratings",
        severity: "warn",
        impact: "trust",
        title: `Ratings are polarized (${observed})`,
        detail:
          `Apple's histogram over all ${signal.count.toLocaleString("en-US")} ratings is bimodal — ` +
          `a large 1★ cohort hides behind the ${signal.average} average.`,
        fix: "Find what the 1★ cohort hits — cross-reference the review topics above when present.",
        evidence: `${observed} (n=${signal.count.toLocaleString("en-US")})`,
      }),
    );
  }

  if (signal.thin) {
    out.push(
      mk({
        id: "ratings_thin",
        surface: "ratings",
        severity: "info",
        impact: "trust",
        title: `Only ${signal.count.toLocaleString("en-US")} ratings — too few to read the shape`,
        detail:
          "Apple itself shows \"Not Enough Ratings\" territory at counts this low — a fact about the ratings base, not a verdict on the app.",
        fix: "No action required — ratings context only. In-app rating prompts at the right moment grow the base.",
        evidence: `n=${signal.count.toLocaleString("en-US")} ratings`,
        context: true,
      }),
    );
  }
  return out;
}

/**
 * privacy — the public storefront nutrition labels (storefront-intel PRD 04).
 * Absent labels ⇒ silence (extraction-degrade is indistinguishable from genuine
 * absence — never "you have no privacy labels").
 */
function privacyFindings(input: AuditFindingsInput): Finding[] {
  const labels = input.storefront?.privacyLabels;
  if (!labels || labels.length === 0) return [];
  if (labels.length === 1 && labels[0] === "DATA_NOT_COLLECTED") {
    return [
      mk({
        id: "privacy_data_not_collected",
        surface: "privacy",
        severity: "good",
        impact: "trust",
        title: "Privacy label: Data Not Collected",
        detail:
          "Your product page shows Apple's \"Data Not Collected\" label — a real trust and conversion signal shoppers see before they install.",
        fix: "Nice — keep it accurate as the app evolves.",
        evidence: "DATA_NOT_COLLECTED",
        context: true,
      }),
    ];
  }
  return [
    mk({
      id: "privacy_labels_observed",
      surface: "privacy",
      severity: "info",
      impact: "trust",
      title: "Privacy labels on your listing",
      detail: "These are the privacy labels shoppers see on your product page.",
      fix: "Confirm they match what your app actually does — mismatches risk review rejection.",
      evidence: labels.join(", "),
      context: true,
    }),
  ];
}

/**
 * IAP visibility — display names are public and can surface in App Store search
 * (storefront-intel PRD 04). Keyword claims only against TRACKED keywords from
 * ranks; prices are quoted as observed facts, never priced advice. Absent ⇒
 * silence.
 */
function iapFindings(input: AuditFindingsInput): Finding[] {
  const iaps = input.storefront?.inAppPurchases;
  if (!iaps || iaps.length === 0) return [];
  const tracked = topKeywords(input.ranks, 10).map((k) => k.toLowerCase());
  const matches = iaps.filter((iap) =>
    tracked.some((kw) => iap.name.toLowerCase().includes(kw)),
  );
  if (matches.length > 0) {
    return [
      mk({
        id: "iap_names_keyword_bearing",
        surface: "iap",
        severity: "good",
        impact: "ranking",
        title: "Your in-app purchase names carry tracked keywords",
        detail:
          "IAP display names are public and can surface in App Store search — yours already work as extra keyword surface.",
        fix: "Keep new IAP names descriptive and keyword-bearing.",
        evidence: matches.map((m) => m.name).join(", "),
        context: true,
      }),
    ];
  }
  return [
    mk({
      id: "iap_names_generic",
      surface: "iap",
      severity: "info",
      impact: "ranking",
      title: "In-app purchase names are generic",
      detail:
        "IAP display names show in App Store search but none of yours contain a keyword you track — a wasted free surface.",
      fix: "Give in-app purchases descriptive, keyword-bearing display names (not just \"Premium Monthly\").",
      evidence: iaps.map((i) => i.name).join(", "),
      context: true,
    }),
  ];
}

/** Boilerplate What's New patterns — measured against text we actually captured. */
const WHATS_NEW_BOILERPLATE = [
  /^bug fixes\.?$/i,
  /bug fixes and performance improvements/i,
  /minor (bug )?fixes/i,
  /performance improvements\.?$/i,
  /various (bug fixes|improvements)/i,
  /stability improvements/i,
];

/**
 * release — the public What's New text (storefront-intel PRD 04). v1 ONLY flags
 * boilerplate in text we have; NO date/staleness claim (the extractor carries no
 * release date — see the PRD). Absent whatsNew ⇒ silence.
 */
function releaseFindings(input: AuditFindingsInput): Finding[] {
  const text = input.storefront?.whatsNew?.trim();
  if (!text) return [];
  if (!WHATS_NEW_BOILERPLATE.some((re) => re.test(text))) return [];
  return [
    mk({
      id: "whats_new_boilerplate",
      surface: "release",
      severity: "info",
      impact: "conversion",
      title: "Your \"What's New\" is boilerplate",
      detail:
        "The release notes shoppers see are a generic \"bug fixes\" line — a missed spot to show momentum and highlight what shipped.",
      fix: "Name what actually changed; a specific note reads as an actively-maintained app.",
      evidence: text.length > 60 ? `${text.slice(0, 57)}…` : text,
    }),
  ];
}

/**
 * chart — the app's PUBLIC category chart position (analytics-reports PRD 04
 * map). A measured position when ranked; a "not in the top N of your category"
 * status when the chart was read but the app is absent; silence when unknown
 * (unreadable chart / unknown genre). Keyless-friendly — no ASC needed.
 */
function chartRankFindings(input: AuditFindingsInput): Finding[] {
  const cr = input.chartRank;
  if (!cr) return []; // null/undefined ⇒ unknown ⇒ silence
  const where = cr.genreName ?? "your category";
  const chartLabel =
    cr.chart === "top-free" ? "Top Free" : cr.chart === "top-paid" ? "Top Paid" : "Top Grossing";
  if (cr.ranked) {
    return [
      mk({
        id: "chart_rank_present",
        surface: "chart",
        severity: "good",
        impact: "ranking",
        title: `#${cr.position} in ${where} (${chartLabel})`,
        detail: `You're charting at #${cr.position} of the top ${cr.outOf} ${where} apps in ${cr.country.toUpperCase()} — real category visibility.`,
        fix: "Hold it: sustained ranking compounds. Watch this move as you ship changes.",
        evidence: `#${cr.position}/${cr.outOf} · ${chartLabel} · ${cr.country.toUpperCase()}`,
        context: true,
      }),
    ];
  }
  return [
    mk({
      id: "chart_rank_absent",
      surface: "chart",
      severity: "info",
      impact: "ranking",
      title: `Not in the top ${cr.outOf} of ${where}`,
      detail: `You're outside the ${chartLabel} chart for ${where} in ${cr.country.toUpperCase()} — category charts drive browse discovery you're not capturing.`,
      fix: "Keyword + conversion wins lift installs, which is what moves chart position.",
      evidence: `outside top ${cr.outOf} · ${chartLabel} · ${cr.country.toUpperCase()}`,
      context: true,
    }),
  ];
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
    ...previewFindings(input),
    ...appInfoFindings(input),
    ...versionFindings(input.snapshot),
    ...pricingFindings(input.snapshot),
    ...ageRatingFindings(input.snapshot),
    ...cppFindings(input),
    ...localeFindings(input),
    ...reviewFindings(input),
    ...ratingsFindings(input),
    ...privacyFindings(input),
    ...iapFindings(input),
    ...releaseFindings(input),
    ...chartRankFindings(input),
    ...metaFindings(input),
    ...reviewRiskFindings(input.proposedCopy),
    ...ppoFindings(input.snapshot?.experiments),
    ...ppoResultFindings(input.snapshot?.ppoResults?.results ?? []),
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

