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
  artworkUrlFrom,
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
import { isStrongSubtitle, optimizeCopy, type ProposedCopy } from "./optimize.js";
import { authorSubtitle } from "./copyAuthor.js";
import type { Reasoner } from "./keywordReasoner.js";
import { type Rank, ranksFor } from "./rankCheck.js";
import { score as scoreScreenshots, type ShotScore } from "./screenshotScore.js";
import { fetchStorefrontListing, type StorefrontListing } from "./storefrontListing.js";
import type { Finding, SurfaceLock } from "./auditFindings.js";
import type { AscContext } from "./ascContext.js";
import type { Opportunity } from "./rankOpportunity.js";
import type { CoverageReport } from "./metadataCoverage.js";
import type { LocaleRecommendation } from "./localizationExpansion.js";
import type { PpoTreatmentPlan } from "./ppoTreatment.js";
import type { LanguageCoverage } from "./languageCoverage.js";
import { categoryRankFrom, fetchChartRead, type CategoryRank, type ChartRank, type ChartRead } from "./chartRank.js";
import type { ReviewSentiment } from "./reviewSentiment.js";

/**
 * Which App Store surface a rating was read from (#326). The lookup API and the
 * public listing page can report different numbers, so the audit records the
 * surface rather than presenting one anonymous "the rating".
 */
export type RatingSource = "lookup" | "storefront";

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

/**
 * The REMAINING storefront listing intel — everything the one public page fetch
 * carries beyond the subtitle + shots the audit already consumes. Carried on the
 * audit (and thus the persisted run trace) so downstream feature work reads it
 * from a stored run instead of editing audit() again. Every field is optional
 * and independently extracted: a structure drift degrades a field, never a run.
 */
export type StorefrontIntel = Omit<StorefrontListing, "subtitle" | "shots">;

export type Audit = {
  app: string;
  bundleId: string;
  screenshots: ShotScore | null;
  liveName: string;
  /** The live listing's description, when iTunes returns one — used as baseCopy
   *  so a connect-by-name proposal isn't blank (issue #12). */
  liveDescription?: string;
  /** The live subtitle, read from the PUBLIC storefront page (the lookup API
   *  never returns it) — lets keyless runs see the real subtitle honestly. */
  liveSubtitle?: string;
  /** The rest of the public storefront page (ratings, What's New, privacy labels,
   *  languages, category, IAPs, similar apps, more-by-developer) from the SAME
   *  single fetch. Absent when the page was unreadable or carried none of these —
   *  unknown, never an empty object. */
  storefront?: StorefrontIntel;
  /** The live version string, when the lookup returns one (#326). Absent when
   *  the lookup was unreadable or carried no version — unknown, never "1.0". */
  liveVersion?: string;
  /**
   * The live star rating (#326), read from one of the two surfaces the audit
   * already fetches. Each half is independently measured: a read average with
   * an unread count is `{ average, count: null }`, never a fabricated count.
   * The whole field is absent when neither half was readable. A rating is a
   * MEASUREMENT, so an unrated app reads as absent, never as a 0-star app.
   *
   * `source` names the surface the pair was read from. The lookup wins when it
   * read EITHER half; the storefront page is a fallback only for a lookup that
   * carried no rating at all. The two surfaces can disagree, so halves are
   * never merged across them — a pair always describes one surface.
   */
  rating?: { average: number | null; count: number | null; source: RatingSource };
  /**
   * The app's CATEGORY chart position (#326), narrowed from the run's measured
   * `chartRank` so the status bar reads one field. `rank: null` means we read
   * the chart and the app was NOT in it; the whole field is absent when the
   * chart was never read (unknown) — the bar then shows its honest placeholder.
   */
  categoryRank?: CategoryRank;
  /**
   * The app's own icon artwork url (#455) — what the icon comparison measures
   * YOUR icon from, alongside the neighbour set's. Absent when the lookup
   * carried no artwork: an icon we cannot fetch is unmeasured, never a blank
   * url that would fail every read downstream while passing a truthiness check.
   */
  artworkUrl?: string;
  /** App Store trackId (from lookup) — the id to find in a chart feed. */
  trackId?: string;
  /** Primary genre id + name (from lookup) — the CATEGORY chart to check. */
  primaryGenreId?: string;
  primaryGenreName?: string;
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
   * Product Page Optimization treatment brief (#182 Phase 3) — a concrete,
   * ready-to-run outcome-led screenshot experiment the user sets up in ASC.
   * Present only on a keyed run whose experiments read succeeded AND has no test
   * currently running. Curated recommendation copy + a cited public result — no
   * raw ASC data, no invented metrics. Safe to serialize.
   */
  ppoTreatment?: PpoTreatmentPlan | undefined;
  /**
   * PUBLIC category chart rank (analytics-reports PRD 04 map). A measured
   * position when ranked, `ranked:false` when read-but-absent, undefined when
   * unknown. Public (keyless-friendly); safe to serialize.
   */
  chartRank?: ChartRank | undefined;
  /**
   * The ordered chart ids the SAME feed read carried (#455). `chartRank` is this
   * list reduced to our position; the icon comparison needs the list itself —
   * who is at the top of your category — so it rides along rather than costing a
   * second read of the identical feed. Absent whenever `chartRank` is.
   */
  chartEntries?: string[] | undefined;
  /**
   * Storefront-intel PRD 03 — MEASURED, language-level localization coverage for
   * KEYLESS runs, from the public page's language list. Language-level (labeled
   * `source:"storefront"`), never claiming locale-level knowledge. Present only on
   * a no-key run whose storefront page listed languages; the keyed ASC locale
   * list stays authoritative and never carries this. Optional; safe to serialize.
   */
  languageCoverage?: LanguageCoverage | undefined;
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
  let liveSubtitle: string | undefined;
  let storefront: StorefrontIntel | undefined;
  let trackId: string | undefined;
  let primaryGenreId: string | undefined;
  let primaryGenreName: string | undefined;
  let liveVersion: string | undefined;
  let artworkUrl: string | undefined;
  let rating: { average: number | null; count: number | null; source: RatingSource } | undefined;
  try {
    const url = buildUrl(ITUNES_LOOKUP_URL, { bundleId: input.bundleId, country });
    const data = asResponse(await fetchJson(fetchFn, url));
    const r = (data.results ?? [])[0] as ItunesResult | undefined;
    if (r) {
      liveName = r.trackName ?? "";
      if (r.trackId) trackId = String(r.trackId);
      if (r.primaryGenreId) primaryGenreId = r.primaryGenreId;
      if (r.primaryGenreName) primaryGenreName = r.primaryGenreName;
      // #455 — the app's OWN icon, from the lookup we already did. The icon
      // comparison measures this against the neighbour set; absent when the
      // result carried no artwork at all.
      artworkUrl = artworkUrlFrom(r);
      const desc = r.description?.trim();
      if (desc) liveDescription = desc;
      // #326 — status-bar stats off the read we already did. Each field is
      // independently measured; an absent one stays absent (unknown), and a
      // half-read rating carries `null` for the half we could not measure.
      const version = r.version?.trim();
      if (version) liveVersion = version;
      const average = typeof r.averageUserRating === "number" && Number.isFinite(r.averageUserRating)
        ? Math.round(r.averageUserRating * 10) / 10
        : null;
      const count = typeof r.userRatingCount === "number" && Number.isFinite(r.userRatingCount)
        ? r.userRatingCount
        : null;
      if (average !== null || count !== null) rating = { average, count, source: "lookup" };
      // The public storefront page carries what the lookup API doesn't: the
      // subtitle always, and the screenshot set the lookup frequently omits
      // (#41). One best-effort fetch enriches both; never fails the audit.
      const page = r.trackViewUrl ? await fetchStorefrontListing(fetchFn, r.trackViewUrl) : null;
      if (page?.subtitle) liveSubtitle = page.subtitle;
      // The storefront page's ratings shelf backs up a lookup that carried no
      // rating at all. The lookup WINS whenever it read either half — a
      // half-read lookup is still a real measurement of that surface, and the
      // two surfaces can disagree, so we never splice halves across them: a
      // {average, count} pair always describes ONE surface, named by `source`.
      if (rating === undefined && page?.ratings) {
        rating = {
          average: page.ratings.average,
          count: page.ratings.count,
          source: "storefront",
        };
      }
      // Thread the REST of the page through ONCE (#feature-work never edits
      // audit() again): everything but the subtitle + shots consumed below.
      // Absent when nothing remains — unknown, never an empty object.
      if (page) {
        const { subtitle: _subtitle, shots: _shots, ...intel } = page;
        if (Object.keys(intel).length > 0) storefront = intel;
      }
      let shots = {
        screenshotUrls: r.screenshotUrls ?? [],
        ipadScreenshotUrls: r.ipadScreenshotUrls ?? [],
      };
      if (shots.screenshotUrls.length === 0 && page?.shots) shots = page.shots;
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
    ...(liveSubtitle !== undefined ? { liveSubtitle } : {}),
    ...(storefront !== undefined ? { storefront } : {}),
    ...(liveVersion !== undefined ? { liveVersion } : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(artworkUrl !== undefined ? { artworkUrl } : {}),
    ...(trackId !== undefined ? { trackId } : {}),
    ...(primaryGenreId !== undefined ? { primaryGenreId } : {}),
    ...(primaryGenreName !== undefined ? { primaryGenreName } : {}),
  };
}

/**
 * Read the app's PUBLIC category chart position from the audit we just did.
 *
 * The legacy top-charts RSS feed needs NO credential, so this runs on every
 * path — a keyless run gets its chart position exactly like a keyed one. Both
 * inputs come from the lookup `audit()` already performed, so this costs one
 * extra request and never re-reads the listing.
 *
 * Returns null — UNKNOWN — when the genre is unreadable (we cannot pick a chart
 * honestly) or the feed does not parse. `fetchChartRank` already distinguishes
 * that from a read-but-absent app (`ranked:false`), and the distinction is the
 * whole point: silence means we did not look, `ranked:false` means we looked and
 * the app was not there.
 */
async function measureChartRank(
  fetchFn: FetchFn,
  auditResult: Audit,
  country: string,
): Promise<ChartRead | null> {
  if (!auditResult.trackId || !auditResult.primaryGenreId) return null;
  return fetchChartRead(fetchFn, {
    appId: auditResult.trackId,
    genreId: auditResult.primaryGenreId,
    ...(auditResult.primaryGenreName !== undefined
      ? { genreName: auditResult.primaryGenreName }
      : {}),
    country,
  });
}

/**
 * Build the (non-executed) push command handoff from proposed copy.
 *
 * DESTRUCTIVE-COMMAND GUARD: only emit a flag for a field we actually PROPOSED.
 * An unread or unchanged field is UNKNOWN — and `asc metadata set --keywords ''`
 * does not mean "leave it alone", it means "blank it". Emitting every flag
 * unconditionally turned an uncredentialed run (which can't read subtitle or
 * keywords) into a command that WIPES the user's live subtitle and keyword field
 * the moment they paste it — the exact opposite of what the run proposed, and it
 * happens on the surface that tells them to run it themselves.
 */
export function buildPushCommands(bundleId: string, copy: ProposedCopy): PushCommand[] {
  const esc = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const flag = (name: string, v: string | undefined) =>
    v === undefined || v === "" ? "" : ` --${name} ${esc(v)}`;

  const listing =
    flag("name", copy.name) + flag("subtitle", copy.subtitle) + flag("keywords", copy.keywords);

  const cmds: PushCommand[] = [];
  // Nothing proposed for the listing fields → no listing command at all. A command
  // that sets nothing is worse than no command: it invites a destructive paste.
  if (listing) {
    cmds.push({
      store: "appstore",
      tool: "asc",
      description: "Stage App Store name + subtitle + keyword field (review-gated).",
      command: `asc metadata set --bundle ${bundleId}${listing}`,
    });
  }
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
 * Run the full loop for one app. PURE except for the injected `fetchFn` (and
 * the optional `deps.copywriter` — a Reasoner used to AUTHOR a subtitle
 * candidate, guardrailed by engine/copyAuthor; absent → the deterministic
 * composer, exactly as before).
 * Order: audit → rank-check → competitor watch+diff → keyword reasoning →
 * propose copy (within limits) → PREPARE push commands (not executed).
 */
export async function runAgent(
  fetchFn: FetchFn,
  input: AppInput,
  // `| undefined` so call sites can pass `reasonerForEnv(env)` directly under
  // exactOptionalPropertyTypes — an undefined copywriter means "none".
  deps: { copywriter?: Reasoner | undefined } = {},
): Promise<AgentResult> {
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
  // keywords when we actually READ them: subtitle from ASC or, failing that, the
  // public storefront page (it IS the live subtitle); keywords are ASC-only —
  // genuinely private, so without a key they stay unknown, never empty.
  const currentCopy: AgentResult["currentCopy"] = {
    ...(input.baseCopy?.name ?? auditResult.liveName ? { name: input.baseCopy?.name ?? auditResult.liveName } : {}),
    ...(input.ascMetadataRead === true
      ? {
          ...(input.baseCopy?.subtitle !== undefined ? { subtitle: input.baseCopy.subtitle } : {}),
          ...(input.baseCopy?.keywords !== undefined ? { keywords: input.baseCopy.keywords } : {}),
        }
      : {
          ...(auditResult.liveSubtitle !== undefined ? { subtitle: auditResult.liveSubtitle } : {}),
        }),
    ...(input.baseCopy?.promo !== undefined ? { promo: input.baseCopy.promo } : {}),
    ...(description !== undefined ? { description } : {}),
  };
  // Claude-authored subtitle candidate (Phase 1 of the Claude brain): spent
  // only when it could actually be USED — the subtitle is writable (ASC read)
  // and the live value is weak enough that the compose branch would run.
  // copyAuthor guardrails the output; null keeps the deterministic composer.
  let authoredSubtitle: string | undefined;
  if (deps.copywriter && input.ascMetadataRead === true && !isStrongSubtitle(input.baseCopy?.subtitle ?? "")) {
    const authored = await authorSubtitle(deps.copywriter, {
      appName: input.baseCopy?.name ?? auditResult.liveName,
      description: description ?? "",
      targets: reasoning
        .filter((k) => k.bucket === "Secondary" || k.bucket === "Primary")
        .map((k) => k.keyword),
    });
    if (authored !== null) authoredSubtitle = authored;
  }

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
    {
      canWriteSubtitleKeywords: input.ascMetadataRead === true,
      ...(authoredSubtitle !== undefined ? { authoredSubtitle } : {}),
    },
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

  // 8. PUBLIC category chart position. Keyless — the genre chart feed needs no
  //    ASC credential, so this is measured on every run, not just a keyed one.
  //    Degrade-safe: null on an unknown genre or an unreadable feed, which
  //    leaves BOTH `chartRank` and `audit.categoryRank` absent (unknown) rather
  //    than asserting a false "not charting".
  const chartRead = await measureChartRank(fetchFn, auditResult, country);
  const chartRank = chartRead?.rank ?? null;
  const categoryRank = categoryRankFrom(chartRank);

  return {
    audit: {
      ...auditResult,
      ...(categoryRank !== undefined ? { categoryRank } : {}),
    },
    ranks,
    competitors: { listings, changes, digest: digestLine(changes) },
    reasoning,
    currentCopy,
    proposedCopy,
    pushCommands,
    keywordGaps,
    ...(chartRank !== null ? { chartRank } : {}),
    ...(chartRead ? { chartEntries: chartRead.entries } : {}),
  };
}

// re-export the single-listing lookup for callers that want it without reaching
// into competitorWatch directly.
export { lookup as competitorLookup };
export type { ScoredKeyword };
