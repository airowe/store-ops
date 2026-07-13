/**
 * Play category chart rank — the keyless, MEASURED "#N in <category>" position;
 * the data-map's highest-value public gap and the Android sibling of the iTunes
 * top-charts read (`../chartRank.ts`).
 *
 * Google Play has no official top-charts JSON (unlike Apple's marketing-tools
 * RSS). The only keyless route is Play's internal `batchexecute` `vyAe2` RPC,
 * which is BRITTLE (a giant hard-coded field-mask; drift-prone). So the concrete
 * scraper (`playChartSource.ts`) is isolated behind an injected `PlayChartSource`
 * and is degrade-safe + gated; THIS module is the pure computation + finding and
 * unit-tests with zero network.
 *
 * Honest by construction (mirrors chartRank.ts): the source returns an ordered
 * list of package ids; if the app is in it, its 1-based index IS the measured
 * rank. Not in the top `outOf` → `ranked:false` (never a fabricated number). An
 * unreadable chart → `null` (UNKNOWN), distinct from "not charting". Never throws.
 */
import { type Finding, mk } from "../findings/core.js";

export type PlayChartCollection = "TOP_FREE" | "TOP_PAID" | "GROSSING";

const COLLECTION_LABEL: Record<PlayChartCollection, string> = {
  TOP_FREE: "Top Free",
  TOP_PAID: "Top Paid",
  GROSSING: "Top Grossing",
};

export type PlayChartRankMeta = {
  collection: PlayChartCollection;
  /** Play category id, e.g. "WEATHER" | "GAME_PUZZLE". */
  category: string;
  categoryName?: string;
  country: string;
};

export type PlayChartRank = PlayChartRankMeta & {
  /** how many entries the chart returned (the depth we actually saw). */
  outOf: number;
} & ({ ranked: true; position: number } | { ranked: false });

/**
 * The injected keyless chart source: ordered package ids for a
 * (collection, category, country). Pure seam (like `FetchFn`) — tests inject a
 * fake; the concrete impl scrapes Play and is degrade-safe.
 */
export type PlayChartSource = (opts: {
  collection: PlayChartCollection;
  category: string;
  country: string;
  limit?: number;
}) => Promise<string[]>;

/** Pure: locate `packageName` in an ordered id list and shape the PlayChartRank. */
export function playChartRankFromEntries(
  entries: string[],
  packageName: string,
  meta: PlayChartRankMeta,
): PlayChartRank {
  const base = {
    collection: meta.collection,
    category: meta.category,
    ...(meta.categoryName !== undefined ? { categoryName: meta.categoryName } : {}),
    country: meta.country,
    outOf: entries.length,
  };
  const idx = entries.indexOf(packageName);
  return idx >= 0 ? { ...base, ranked: true, position: idx + 1 } : { ...base, ranked: false };
}

/**
 * Fetch the chart via the injected source and locate the app. Returns a
 * PlayChartRank (ranked or not) on a good read, or `null` when the chart is
 * unreadable/empty (UNKNOWN — never a false "not charting"). Degrade-safe: a
 * throwing source resolves to null.
 */
export async function fetchPlayChartRank(
  source: PlayChartSource,
  opts: {
    packageName: string;
    collection?: PlayChartCollection;
    category: string;
    categoryName?: string;
    country?: string;
    limit?: number;
  },
): Promise<PlayChartRank | null> {
  if (!opts.category) return null;
  const collection = opts.collection ?? "TOP_FREE";
  const country = opts.country ?? "us";
  const limit = opts.limit ?? 100;
  let entries: string[];
  try {
    entries = await source({ collection, category: opts.category, country, limit });
  } catch {
    return null;
  }
  if (!Array.isArray(entries) || entries.length === 0) return null; // UNKNOWN
  return playChartRankFromEntries(entries, opts.packageName, {
    collection,
    category: opts.category,
    ...(opts.categoryName !== undefined ? { categoryName: opts.categoryName } : {}),
    country,
  });
}

const SURFACE = "chartRank";

/**
 * A finding for a measured chart position. A ranked position is a measured
 * STATUS fact (context) — "#N in Weather (Top Free, US)". "Not charting" is also
 * an honest measured fact (context). An UNKNOWN (`null`) read contributes nothing.
 */
export function playChartRankFinding(rank: PlayChartRank | null): Finding[] {
  if (rank === null) return [];
  const cat = rank.categoryName ?? rank.category;
  const where = `${cat} (${COLLECTION_LABEL[rank.collection]}, ${rank.country.toUpperCase()})`;
  if (rank.ranked) {
    return [
      mk({
        id: "play_chart_rank",
        surface: SURFACE,
        severity: rank.position <= 100 ? "good" : "info",
        impact: "ranking",
        title: `#${rank.position} in ${where} on Google Play`,
        detail: `A measured category-chart position (of the top ${rank.outOf} we read). Category chart rank is a real, keyless Play signal — not a search-keyword rank.`,
        fix: "",
        evidence: `#${rank.position} of ${rank.outOf}`,
        context: true,
      }),
    ];
  }
  return [
    mk({
      id: "play_chart_not_charting",
      surface: SURFACE,
      severity: "info",
      impact: "ranking",
      title: `Not in the top ${rank.outOf} of ${where}`,
      detail: "We read the category chart and didn't find this app in it — a measured fact, not an estimate.",
      fix: "",
      evidence: `outside top ${rank.outOf}`,
      context: true,
    }),
  ];
}
