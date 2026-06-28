/**
 * Google Play audit loop — the Android analog of the iOS `runAgent` audit, built
 * on the store abstraction. Given a Google Play `StoreAdapter` and a package id,
 * it drives the whole Play pipeline through ONE store-agnostic seam:
 *
 *   adapter.readListing → scoreScreenshotGroups → playCoverage
 *   → analyzePlayKeywords → playFindings → summarize + playSurfaceLocks
 *
 * Pure except for the adapter's injected fetch, so it unit-tests with a fake
 * adapter and zero network.
 *
 * HONESTY: a field the read could not measure is `null` on the listing; we map
 * `null → undefined` into the analyzers so it reads as UNSEEN (seen:false),
 * never a measured-empty. The unread surfaces surface as `locks`, not findings.
 */
import { type Finding, type FindingsSummary, type SurfaceLock, summarizeFindings } from "../findings/core.js";
import { type FamilyShotScore, scoreScreenshotGroups } from "../screenshotScore.js";
import type { StoreAdapter, NormalizedListing } from "../store/types.js";
import { type PlayCoverageReport, playCoverage } from "./playCoverage.js";
import { type PlayKeywordReport, analyzePlayKeywords } from "./playKeywordModel.js";
import { playFindings, playSurfaceLocks } from "./playFindings.js";

export type PlayAudit = {
  appId: string;
  listing: NormalizedListing;
  /** screenshot grade over the listing's device families (phone primary). */
  screenshots: FamilyShotScore;
  /** 30/80/4000 budget efficiency + stuffing/brand waste. */
  coverage: PlayCoverageReport;
  /** target-term coverage across title/short/long (empty when no targets given). */
  keywords: PlayKeywordReport;
  /** sorted Android findings. */
  findings: Finding[];
  /** counts + headline label for the audit card. */
  summary: FindingsSummary;
  /** surfaces this run could not read (capability locks, never deficiencies). */
  locks: SurfaceLock[];
};

export type AuditPlayListingOptions = {
  country?: string;
  lang?: string;
  /** target search terms to measure coverage for (from keywordReasoner, etc.). */
  targets?: string[];
  /** the app's brand, so brand-burn in the short description is flagged. */
  brand?: string;
};

/** null → undefined, so an UNMEASURED field reads as UNSEEN in the analyzers. */
function u(s: string | null): string | undefined {
  return s ?? undefined;
}

/**
 * Audit one Google Play listing end to end via a Play `StoreAdapter`.
 * Throws if handed a non-Play adapter (this is the Android loop; iOS keeps its
 * own snapshot-based audit path).
 */
export async function auditPlayListing(
  adapter: StoreAdapter,
  appId: string,
  opts: AuditPlayListingOptions = {},
): Promise<PlayAudit> {
  if (adapter.profile.id !== "googleplay") {
    throw new Error(`auditPlayListing requires a Google Play adapter, got "${adapter.profile.id}"`);
  }

  const readOpts = {
    ...(opts.country !== undefined ? { country: opts.country } : {}),
    ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
  };
  const listing = await adapter.readListing(appId, readOpts);

  const screenshots = scoreScreenshotGroups(
    appId,
    { groups: listing.screenshots, reliable: listing.reliable },
    adapter.profile,
  );

  const copy = {
    title: u(listing.title),
    shortDescription: u(listing.tagline),
    description: u(listing.longDescription),
  };
  const coverage = playCoverage(copy, opts.brand !== undefined ? { brand: opts.brand } : {});
  const keywords = analyzePlayKeywords({ ...copy, targets: opts.targets ?? [] });

  const findings = playFindings({ listing, screenshots, keywords, coverage });

  return {
    appId,
    listing,
    screenshots,
    coverage,
    keywords,
    findings,
    summary: summarizeFindings(findings),
    locks: playSurfaceLocks(listing),
  };
}
