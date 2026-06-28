/**
 * Google Play findings — the Android rule set, the sibling of `auditFindings.ts`.
 *
 * Uses the SAME store-agnostic findings core (`findings/core.ts`) for the
 * Finding shape, scoring, sorting and the SurfaceLock machinery — only the
 * per-surface RULES are Android-specific. Rules read a `NormalizedListing` plus
 * the already-computed Play models (coverage, keyword model, screenshot score).
 *
 * HONESTY (constraints #1, #3):
 *   • A field that was NOT measured (`null` on the listing, e.g. a public scrape
 *     can't see the separate short description) NEVER produces a "missing X"
 *     deficiency — it produces a SurfaceLock ("connect to read + improve"). Only
 *     a MEASURED-empty ("") field is a deficiency.
 *   • No iOS keyword-field assumptions: rules talk about the title / short
 *     description / long-description keyword surface, the stuffing risk, and the
 *     long-description coverage gap — never a keyword field.
 *
 * Pure + deterministic; degrades gracefully (absent model ⇒ no findings for it,
 * never throws).
 */
import { type Finding, type SurfaceLock, mk, sortFindings } from "../findings/core.js";
import type { FamilyShotScore } from "../screenshotScore.js";
import type { NormalizedListing } from "../store/types.js";
import type { PlayCoverageReport } from "./playCoverage.js";
import type { PlayKeywordReport } from "./playKeywordModel.js";

/** A long description shorter than this under-uses the 4000-char indexed surface. */
const THIN_DESCRIPTION = 500;

export type PlayFindingsInput = {
  listing: NormalizedListing;
  /** screenshot score (via `scoreScreenshotGroups`), when computed. */
  screenshots?: FamilyShotScore | undefined;
  /** keyword coverage (via `analyzePlayKeywords`), when targets are known. */
  keywords?: PlayKeywordReport | undefined;
  /** coverage report (via `playCoverage`), when computed. */
  coverage?: PlayCoverageReport | undefined;
};

/** title — only `null` (unmeasured) or measured-empty are actionable. */
function titleFindings(listing: NormalizedListing): Finding[] {
  if (listing.title === null) {
    return [
      mk({
        id: "play_title_unread",
        surface: "title",
        severity: "info",
        impact: "completeness",
        title: "Couldn't read the app title",
        detail: "The public Play page data didn't carry a title — likely a read limitation.",
        fix: "Connect the Play Developer API to read your live title.",
      }),
    ];
  }
  if (listing.title.trim() === "") {
    return [
      mk({
        id: "play_title_missing",
        surface: "title",
        severity: "critical",
        impact: "ranking",
        title: "No app title",
        detail: "The title is Play's most heavily-weighted ranking field; an empty title can't rank.",
        fix: "Set a clear, keyword-bearing title (≤30 chars).",
      }),
    ];
  }
  return [];
}

/** long description — the indexed keyword surface; thin/empty under-uses it. */
function descriptionFindings(listing: NormalizedListing): Finding[] {
  const desc = listing.longDescription;
  if (desc === null) return []; // unmeasured → handled by a SurfaceLock, not a deficiency
  if (desc.trim() === "") {
    return [
      mk({
        id: "play_description_empty",
        surface: "description",
        severity: "critical",
        impact: "ranking",
        title: "Empty long description",
        detail:
          "Google Play indexes the long description for search — an empty one forfeits your main keyword surface.",
        fix: "Write a full long description (up to 4000 chars) covering what users search for.",
      }),
    ];
  }
  if (desc.length < THIN_DESCRIPTION) {
    return [
      mk({
        id: "play_description_thin",
        surface: "description",
        severity: "warn",
        impact: "ranking",
        title: "Thin long description",
        detail:
          "Play ranks on the long description's term coverage; a short one under-uses the 4000-char keyword surface.",
        fix: "Expand the description with the terms users actually search for.",
        evidence: `${desc.length}/4000 chars`,
      }),
    ];
  }
  return [];
}

/** short description (tagline) — only a MEASURED-empty value is a deficiency. */
function shortDescriptionFindings(listing: NormalizedListing): Finding[] {
  const short = listing.tagline;
  if (short === null) return []; // unmeasured → SurfaceLock
  if (short.trim() === "") {
    return [
      mk({
        id: "play_short_description_missing",
        surface: "shortDescription",
        severity: "warn",
        impact: "conversion",
        title: "No short description",
        detail:
          "The 80-char short description is indexed AND the first copy a shopper reads above the fold.",
        fix: "Write a punchy, keyword-bearing short description (≤80 chars).",
      }),
    ];
  }
  return [];
}

/** screenshots — reuse the device-family score's grade (Android phone primary). */
function screenshotFindings(input: PlayFindingsInput): Finding[] {
  const shot = input.screenshots;
  if (!shot) return [];
  const out: Finding[] = [];
  const reliable = shot.grade !== "?";

  if (!reliable) {
    out.push(
      mk({
        id: "play_screenshots_unknown",
        surface: "screenshots",
        severity: "info",
        impact: "conversion",
        title: "Couldn't read screenshots from public data",
        detail: "The public Play page didn't return screenshots, so we can't grade them reliably.",
        fix: "Connect the Play Developer API for a real screenshot grade.",
      }),
    );
    return out;
  }
  if (shot.grade === "D" || shot.grade === "F") {
    out.push(
      mk({
        id: "play_screenshots_grade_low",
        surface: "screenshots",
        severity: "critical",
        impact: "conversion",
        title: `Screenshots are hurting conversion (grade ${shot.grade})`,
        detail: "Weak screenshots cost installs — they're the first thing a shopper judges.",
        fix: "Add more tall phone screenshots; the first few carry most installs.",
        evidence: `grade ${shot.grade}`,
      }),
    );
  } else if (shot.primaryCount >= 1 && shot.primaryCount <= 3) {
    out.push(
      mk({
        id: "play_screenshots_thin",
        surface: "screenshots",
        severity: "warn",
        impact: "conversion",
        title: `Only ${shot.primaryCount} phone screenshot${shot.primaryCount === 1 ? "" : "s"}`,
        detail: "You're leaving conversion on the table by not filling the screenshot slots.",
        fix: "Add more phone screenshots; the first few convert hardest.",
        evidence: `${shot.primaryCount} phone shots`,
      }),
    );
  }
  return out;
}

/** keyword surface — stuffing risk + long-description coverage gaps. */
function keywordFindings(input: PlayFindingsInput): Finding[] {
  const out: Finding[] = [];
  const stuffed = input.keywords?.stuffed ?? [];
  const stuffingFromCoverage = input.coverage?.stuffingRisk ?? false;
  if (stuffed.length > 0 || stuffingFromCoverage) {
    const terms = stuffed.length > 0 ? stuffed.join(", ") : undefined;
    out.push(
      mk({
        id: "play_keyword_stuffing",
        surface: "description",
        severity: "warn",
        impact: "ranking",
        title: "Keyword stuffing risk in the long description",
        detail:
          "A term repeated too often reads as stuffing to Play and can suppress ranking rather than help it.",
        fix: "Vary the language; aim for natural coverage, not repetition.",
        ...(terms ? { evidence: terms } : {}),
      }),
    );
  }

  const missing = input.keywords?.missingFromDescription ?? [];
  if (missing.length > 0) {
    out.push(
      mk({
        id: "play_keyword_gaps",
        surface: "description",
        severity: "info",
        impact: "ranking",
        title: `${missing.length} target term${missing.length === 1 ? "" : "s"} absent from the long description`,
        detail:
          "Google Play ranks on the long description; targets you never mention there can't rank from it.",
        fix: "Work the missing terms into the description naturally.",
        evidence: missing.slice(0, 5).join(", "),
      }),
    );
  }
  return out;
}

/** category — only context / a read note. */
function categoryFindings(listing: NormalizedListing): Finding[] {
  if (listing.category === null) return [];
  const name = listing.category.name ?? listing.category.id;
  return [
    mk({
      id: "play_category_context",
      surface: "category",
      severity: "info",
      impact: "ranking",
      title: `Category: ${name}`,
      detail: "Your category shapes which charts and searches you appear in.",
      fix: "Confirm it matches the terms you're targeting.",
      evidence: name,
    }),
  ];
}

/**
 * Compute the sorted Android findings for a Play listing. Pure + deterministic.
 * Each surface degrades independently — an absent model contributes nothing.
 */
export function playFindings(input: PlayFindingsInput): Finding[] {
  const findings: Finding[] = [
    ...titleFindings(input.listing),
    ...shortDescriptionFindings(input.listing),
    ...descriptionFindings(input.listing),
    ...screenshotFindings(input),
    ...keywordFindings(input),
    ...categoryFindings(input.listing),
  ];
  return sortFindings(findings);
}

// ── Locked-surface catalog (#61) for Play ────────────────────────────────────
//
// On a public scrape (`reliable === false`) some surfaces simply can't be SEEN —
// notably the separate 80-char short description and per-device-family
// screenshots, which live in owner-only / deep data we don't read. These render
// as honest "connect to read + improve" locks, never deficiencies. A connected
// (Play Developer API) read sets `reliable === true` and locks NOTHING.

/**
 * The surfaces this run could NOT read for a Play listing. Capability/opportunity
 * copy only — never asserts a deficiency in an unseen field (the #61 invariant).
 */
export function playSurfaceLocks(listing: NormalizedListing): SurfaceLock[] {
  if (listing.reliable) return [];
  const locks: SurfaceLock[] = [];
  if (listing.tagline === null) {
    locks.push({
      surface: "shortDescription",
      label: "We can't see your short description without a Play connection",
      unlockCopy: "Connect the Play Developer API to read your live short description and improve it.",
    });
  }
  if (listing.longDescription === null) {
    locks.push({
      surface: "description",
      label: "We can't see your full long description without a Play connection",
      unlockCopy: "Connect the Play Developer API to read your live long description and improve it.",
    });
  }
  // We only ever see a flat phone screenshot set on a public scrape — tablet
  // coverage is unreadable, framed as an opportunity, never a deficiency.
  locks.push({
    surface: "screenshots",
    label: "We can't see your per-device (tablet) screenshots without a Play connection",
    unlockCopy: "Connect the Play Developer API to grade your full per-device screenshot set.",
  });
  return locks;
}
