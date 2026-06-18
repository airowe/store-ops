/**
 * ascContext — the serialization privacy boundary (PRD 02,
 * `docs/prd/asc-findings/02-run-integration.md`).
 *
 * The captured `AscSnapshot` is bulky and partly sensitive: it carries pricing
 * numbers, every locale's full copy, privacy-policy text, IAP product ids, and
 * asset URLs. NONE of that should reach the browser. The findings already encode
 * the actionable conclusions; `AscContext` carries only the handful of NON-
 * sensitive display scalars a finding references ("Category: Weather", "2
 * locales"). Minimal surface, no leak.
 *
 * This module is PURE + network-free so the boundary is exhaustively unit-tested
 * (incl. a negative leak test). It derives ONLY from the already-read snapshot.
 */
import type { AscSnapshot } from "./ascRead.js";

/**
 * The slim, PII-safe context the run-page card may display. Every field is a
 * label or a count — never raw pricing, locale copy, policy text, or a URL.
 * All optional: a surface that wasn't read simply omits its key.
 */
export type AscContext = {
  /** primary category display name (or its id when the name wasn't resolved). */
  category?: string | undefined;
  /** secondary category display name (or id), when one is set. */
  secondaryCategory?: string | undefined;
  /** Apple's derived age-rating bucket label, e.g. "FOUR_PLUS". */
  ageRating?: string | undefined;
  /** the live version's App Store state, e.g. "READY_FOR_SALE". */
  versionState?: string | undefined;
  /** how many localizations are live — a count, never the copy itself. */
  localeCount?: number | undefined;
  /** how many device families have a preview — a count, never the URLs. */
  previewDeviceCount?: number | undefined;
};

/**
 * Keys that must NEVER appear on an `AscContext` — asserted by the spec so a
 * future careless edit that widens the type is caught. These name the sensitive
 * snapshot surfaces the boundary exists to keep server-side.
 */
export const FORBIDDEN_CONTEXT_KEYS = [
  "pricing",
  "price",
  "baseTerritoryPrice",
  "iaps",
  "locales",
  "privacyPolicyUrl",
  "privacyPolicyText",
  "screenshots",
  "previewUrls",
  "imageTemplate",
] as const;

/**
 * Distil the snapshot down to the safe display scalars. Returns `undefined` on a
 * no-key run (no snapshot). Each surface degrades independently — an absent or
 * errored surface contributes no key rather than throwing.
 */
export function buildAscContext(snapshot: AscSnapshot | undefined): AscContext | undefined {
  if (!snapshot) return undefined;

  const ctx: AscContext = {};

  const appInfo = snapshot.appInfo;
  if (appInfo?.primaryCategory) {
    ctx.category = appInfo.primaryCategory.name ?? appInfo.primaryCategory.id;
  }
  if (appInfo?.secondaryCategory) {
    ctx.secondaryCategory = appInfo.secondaryCategory.name ?? appInfo.secondaryCategory.id;
  }

  const ageRating = snapshot.ageRating?.ageRating;
  if (ageRating) ctx.ageRating = ageRating;

  const versionState = snapshot.versionState?.current.appStoreState;
  if (versionState) ctx.versionState = versionState;

  if (snapshot.locales) ctx.localeCount = snapshot.locales.length;

  const devices = snapshot.previews?.devices;
  if (devices) ctx.previewDeviceCount = devices.length;

  return ctx;
}
