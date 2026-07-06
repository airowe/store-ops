/**
 * The autonomous ASO loop — orchestrator. Ported in spirit from
 * store_ops_orchestrator.py, but pure and injectable: it takes a `FetchFn` and
 * the app's inputs, runs the deterministic data steps, reasons over keywords,
 * proposes copy, and PREPARES (does not execute) the store-push commands.
 *
 * This is what a Worker fetch handler or the weekly Cron calls. It holds NO
 * Cloudflare bindings and NO credentials — the push is a generated command
 * handoff, never an execution (the approval gate lives in the API/DB layer).
 *
 *   runAgent(fetchFn, app) -> { audit, ranks, competitors, reasoning,
 *                               proposedCopy, pushCommands }
 */
import {
  asResponse,
  buildUrl,
  type FetchFn,
  fetchJson,
  type ItunesResult,
} from "./itunes.js";
import { ITUNES_LOOKUP_URL } from "./constants.js";
import {
  type Listing as CompetitorListing,
  diff,
  digestLine,
  lookup,
  lookupAll,
  resolveNameToId,
} from "./competitorWatch.js";
import { bucketize, type KeywordInput, type ScoredKeyword } from "./keywords.js";
import { findKeywordGaps, type KeywordGap } from "./keywordGap.js";
import { optimizeCopy, type ProposedCopy } from "./optimize.js";
import { type Rank, ranksFor } from "./rankCheck.js";
import { score as scoreScreenshots, type ShotScore } from "./screenshotScore.js";
import { fetchStorefrontShots } from "./storefrontShots.js";
import type { Finding, SurfaceLock } from "./auditFindings.js";
import type { AscContext } from "./ascContext.js";
import type { Opportunity } from "./rankOpportunity.js";
import type { CoverageReport } from "./metadataCoverage.js";
import type { LocaleRecommendation } from "./localizationExpansion.js";
import type { ReviewSentiment } from "./reviewSentiment.js";

/** Everything the agent needs to run one app's loop. Pure data in. */
export type AppInput = {
  app: string; // slug
  bundleId: string;
  /** seed/target keywords to rank-check (already 0–100-scaled for reasoning). */
  keywords: KeywordInput[];
  /** competitors as ids, bundle ids, or names (resolved via search). */
  competitors: string[];
  /** previous competitor snapshot (key → watched fields), for diffing. */
  previousCompetitors?: Record<string, Record<string, string>>;
  /** base copy spine to optimize around (current live listing copy). */
  baseCopy?: { name?: string; subtitle?: string; keywords?: string; promo?: string; description?: string };
  /**
   * True ONLY when subtitle + keywords in baseCopy were READ from App Store
   * Connect (the user's key). The public iTunes API can't return those fields,
   * so without an ASC read we must NOT propose subtitle/keyword overwrites —
   * we'd be guessing blind and could downgrade a good listing (#30).
   */
  ascMetadataRead?: boolean;
  country?: string;
};

export type Audit = {
  app: string;
  bundleId: string;
  screenshots: ShotScore | null;
  liveName: string;
  /** The live listing's description, when iTunes returns one — used as baseCopy
   *  so a connect-by-name proposal isn't blank (issue #12). */
  liveDescription?: string;
};

export type AgentResult = {
  audit: Audit;
  ranks: Rank[];
  competitors: { listings: CompetitorListing[]; changes: ReturnType<typeof diff>; digest: string };
  reasoning: ScoredKeyword[];
  /** The CURRENT listing copy the optimizer diffed against (the 'before' for the
   *  run-page PR-style diff). Same floor optimizeCopy received — live values when
   *  read from ASC, else the public listing. Fields absent when unknown. */
  currentCopy: { name?: string; subtitle?: string; keywords?: string; promo?: string; description?: string };
  proposedCopy: ProposedCopy;
  /** generated, NON-executed store push commands (asc / gplay) for handoff. */
  pushCommands: PushCommand[];
  /**
   * Scored, prioritized listing findings (PRD 01/02). Computed in the API run
   * path from the audit + the already-read ASC snapshot, then persisted on the
   * trace. Optional so callers that don't compute them (older paths) stay valid.
   */
  findings?: Finding[] | undefined;
  /**
   * Surfaces a run could NOT read (#61) — the per-surface "unlock to see +
   * improve" lock data. Empty on a Mode-A run (everything readable); the canonical
   * no-key blind-spot list on a public-only run. Static capability/opportunity
   * copy only (no ASC data) — safe to serve. Optional so older callers stay valid.
   */
  locks?: SurfaceLock[] | undefined;
  /**
   * The slim, PII-safe display context a findings card references (category,
   * counts, version state). Present only on a Mode-A (ASC) run. The raw snapshot
   * stays server-side; THIS is the only ASC-derived context that reaches clients.
   */
  ascContext?: AscContext | undefined;
  /**
   * Winnability-ranked keyword opportunities (PRD 06) — "where to push next."
   * Computed in the API run path from the ranks + keyword scores (+ competitor
   * ranks when available), then persisted on the trace and served to the client.
   * Curated copy only (keyword + score + why + drivers) — no raw ASC data. Optional
   * so older/other callers stay valid.
   */
  opportunities?: Opportunity[] | undefined;
  /**
   * Keyword gaps (PRD 01): terms tracked competitors VISIBLY use that you don't
   * target and don't rank top-50 for, sorted by winnability with a `fitsBudget`
   * flag. Inferred from competitors' name/subtitle only — never from their
   * ranking algorithm. Names-only attribution (no raw competitor listing leaks).
   * Safe to serialize to the client. Optional so older paths stay valid.
   */
  keywordGaps?: KeywordGap[] | undefined;
  /**
   * Metadata coverage report (PRD 03) — how hard the 30/30/100 char budget is
   * working, with itemized waste (duplicate / brand_repeat / filler). Computed in
   * the run path from the CURRENT copy + the app's brand. Curated counts + copy
   * only (no raw ASC dump) — safe to serve to the client past the privacy boundary.
   */
  coverage?: CoverageReport | undefined;
  /**
   * Localization expansion recommendations (PRD 04) — ROI-sorted locales to add,
   * from a STATIC, bundled locale-value heuristic (NOT live install data). Derived
   * only from live locale codes + the category name, so it's PII-safe and reaches
   * the client. Present on a Mode-A (ASC) run where we read all locales + category.
   */
  localizationExpansion?: LocaleRecommendation[] | undefined;
  /**
   * PUBLIC review sentiment (#95) — overall sentiment + ranked OBSERVED topics
   * from Apple's free RSS customer-reviews feed. Computed best-effort in the API
   * run path (a fetch failure leaves this undefined, never strands the run). The
   * sample size `n` is ALWAYS carried and the score is SUPPRESSED below threshold
   * (#78). Safe to serialize (public data only). Optional so older paths stay valid.
   */
  reviews?: ReviewSentiment | undefined;
};

export type PushCommand = {
  store: "appstore" | "googleplay";
  tool: "asc" | "gplay";
  description: string;
  command: string;
};

/** Classify a competitor token: numeric → id, has a dot → bundle, else name. */
function classify(tokens: string[]): { ids: string[]; bundles: string[]; names: string[] } {
  const ids: string[] = [];
  const bundles: string[] = [];
  const names: string[] = [];
  for (const t of tokens) {
    if (/^\d+$/.test(t)) ids.push(t);
    else if (t.includes(".")) bundles.push(t);
    else names.push(t);
  }
  return { ids, bundles, names };
}

/** Audit step: fetch the live listing once and score its screenshot set. */
async function audit(fetchFn: FetchFn, input: AppInput): Promise<Audit> {
  const country = input.country ?? "US";
  let screenshots: ShotScore | null = null;
  let liveName = "";
  let liveDescription: string | undefined;
  try {
    const url = buildUrl(ITUNES_LOOKUP_URL, { bundleId: input.bundleId, country });
    const data = asResponse(await fetchJson(fetchFn, url));
    const r = (data.results ?? [])[0] as ItunesResult | undefined;
    if (r) {
      liveName = r.trackName ?? "";
      const desc = r.description?.trim();
      if (desc) liveDescription = desc;
      let shots = {
        screenshotUrls: r.screenshotUrls ?? [],
        ipadScreenshotUrls: r.ipadScreenshotUrls ?? [],
      };
      // #41 fallback: the lookup API frequently omits screenshots for apps that
      // have them. The public storefront page still carries the real set — read
      // it before declaring the set unknown. Best-effort; never fails the audit.
      if (shots.screenshotUrls.length === 0 && r.trackViewUrl) {
        const fromPage = await fetchStorefrontShots(fetchFn, r.trackViewUrl);
        if (fromPage) shots = fromPage;
      }
      screenshots = scoreScreenshots(input.app, {
        ...shots,
        // #41: public sources — an EMPTY set here is UNKNOWN, not zero, so we
        // never assert a false "grade F / can't convert". A non-empty set (from
        // either source) is real and scores normally.
        dataReliable: false,
      });
    }
  } catch {
    screenshots = null;
  }
  return {
    app: input.app,
    bundleId: input.bundleId,
    screenshots,
    liveName,
    ...(liveDescription !== undefined ? { liveDescription } : {}),
  };
}

/** Build the (non-executed) push command handoff from proposed copy. */
export function buildPushCommands(bundleId: string, copy: ProposedCopy): PushCommand[] {
  const esc = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const cmds: PushCommand[] = [
    {
      store: "appstore",
      tool: "asc",
      description: "Stage App Store name + subtitle + keyword field (review-gated).",
      command:
        `asc metadata set --bundle ${bundleId} ` +
        `--name ${esc(copy.name)} --subtitle ${esc(copy.subtitle)} ` +
        `--keywords ${esc(copy.keywords)}`,
    },
  ];
  if (copy.promo !== undefined) {
    cmds.push({
      store: "appstore",
      tool: "asc",
      description: "Stage promotional text (editable without resubmission).",
      command: `asc metadata set --bundle ${bundleId} --promo ${esc(copy.promo)}`,
    });
  }
  // NO Google Play command here. The previous `gplay listing update` was
  // synthesized from the iOS name/subtitle — Android output derived from iOS copy
  // with no real Play audit behind it, which is dishonest (constraint #3). The
  // Play handoff is the `fastlane supply` metadata tree (buildFastlaneSupply),
  // emitted ONLY when a real Play listing was actually read — never from iOS copy.
  return cmds;
}

/**
 * Run the full loop for one app. PURE except for the injected `fetchFn`.
 * Order: audit → rank-check → competitor watch+diff → keyword reasoning →
 * propose copy (within limits) → PREPARE push commands (not executed).
 */
export async function runAgent(fetchFn: FetchFn, input: AppInput): Promise<AgentResult> {
  const country = input.country ?? "US";

  // 1. audit (live listing + screenshot score)
  const auditResult = await audit(fetchFn, input);

  // 2. ranks for the target keywords
  const ranks = await ranksFor(
    fetchFn,
    input.bundleId,
    input.keywords.map((k) => k.keyword),
    { country },
  );

  // 3. competitor watch — resolve names → ids, look up, diff vs previous
  const { ids, bundles, names } = classify(input.competitors);
  const resolvedIds = [...ids];
  for (const nm of names) {
    const rid = await resolveNameToId(fetchFn, nm, { country });
    if (rid) resolvedIds.push(rid);
  }
  const listings = [
    ...(await lookupAll(fetchFn, resolvedIds, { by: "id", country })),
    ...(await lookupAll(fetchFn, bundles, { by: "bundleId", country })),
  ];
  const changes = diff(listings, input.previousCompetitors ?? {});

  // 4. keyword reasoning — score + bucket
  const reasoning = bucketize(input.keywords);

  // 5. propose copy within hard char limits (never over-limit)
  // Prefer an explicit baseCopy, else fall back to the live listing so a
  // connect-by-name proposal carries real copy instead of blanks (issue #12).
  const description = input.baseCopy?.description ?? auditResult.liveDescription;
  // The CURRENT copy: exactly what the optimizer treats as its floor. Captured so
  // the run page can render a current → proposed diff. Only include subtitle/
  // keywords when we actually READ them from ASC (else they're unknown, not empty).
  const currentCopy: AgentResult["currentCopy"] = {
    ...(input.baseCopy?.name ?? auditResult.liveName ? { name: input.baseCopy?.name ?? auditResult.liveName } : {}),
    ...(input.ascMetadataRead === true
      ? {
          ...(input.baseCopy?.subtitle !== undefined ? { subtitle: input.baseCopy.subtitle } : {}),
          ...(input.baseCopy?.keywords !== undefined ? { keywords: input.baseCopy.keywords } : {}),
        }
      : {}),
    ...(input.baseCopy?.promo !== undefined ? { promo: input.baseCopy.promo } : {}),
    ...(description !== undefined ? { description } : {}),
  };
  const proposedCopy = optimizeCopy(
    reasoning,
    {
      name: input.baseCopy?.name ?? auditResult.liveName,
      subtitle: input.baseCopy?.subtitle ?? "",
      ...(input.baseCopy?.keywords !== undefined ? { keywords: input.baseCopy.keywords } : {}),
      ...(input.baseCopy?.promo !== undefined ? { promo: input.baseCopy.promo } : {}),
      ...(description !== undefined ? { description } : {}),
    },
    // Only allow subtitle/keyword proposals when we actually read them from ASC.
    { canWriteSubtitleKeywords: input.ascMetadataRead === true },
  );

  // 6. PREPARE (do not execute) the push command handoff
  const pushCommands = buildPushCommands(input.bundleId, proposedCopy);

  // 7. Keyword gaps (PRD 01) — fuse competitor listings + your ranks + your live
  //    copy. The keyword field is only known when read from ASC; without it we
  //    pass name+subtitle (still honest: we only exclude what we can actually see).
  const keywordGaps = findKeywordGaps({
    yourCopy: {
      name: input.baseCopy?.name ?? auditResult.liveName,
      ...(currentCopy.subtitle !== undefined ? { subtitle: currentCopy.subtitle } : {}),
      ...(currentCopy.keywords !== undefined ? { keywords: currentCopy.keywords } : {}),
    },
    yourRanks: ranks,
    competitors: listings,
  });

  return {
    audit: auditResult,
    ranks,
    competitors: { listings, changes, digest: digestLine(changes) },
    reasoning,
    currentCopy,
    proposedCopy,
    pushCommands,
    keywordGaps,
  };
}

// re-export the single-listing lookup for callers that want it without reaching
// into competitorWatch directly.
export { lookup as competitorLookup };
export type { ScoredKeyword };
