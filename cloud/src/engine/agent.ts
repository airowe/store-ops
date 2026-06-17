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
import { optimizeCopy, type ProposedCopy } from "./optimize.js";
import { type Rank, ranksFor } from "./rankCheck.js";
import { score as scoreScreenshots, type ShotScore } from "./screenshotScore.js";

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
      screenshots = scoreScreenshots(input.app, {
        screenshotUrls: r.screenshotUrls ?? [],
        ipadScreenshotUrls: r.ipadScreenshotUrls ?? [],
        // #41: this is the public iTunes API — it frequently omits screenshots
        // for apps that have them. An empty set here is UNKNOWN, not zero, so we
        // never assert a false "grade F / can't convert".
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
  cmds.push({
    store: "googleplay",
    tool: "gplay",
    description: "Stage Play Store title + short description (no keyword field on Play).",
    command:
      `gplay listing update --package ${bundleId} ` +
      `--title ${esc(copy.name)} --short-description ${esc(copy.subtitle)}`,
  });
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

  return {
    audit: auditResult,
    ranks,
    competitors: { listings, changes, digest: digestLine(changes) },
    reasoning,
    currentCopy,
    proposedCopy,
    pushCommands,
  };
}

// re-export the single-listing lookup for callers that want it without reaching
// into competitorWatch directly.
export { lookup as competitorLookup };
export type { ScoredKeyword };
