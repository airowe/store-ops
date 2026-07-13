/**
 * Play keyword SEARCH rank — the app's organic position for a term on Google
 * Play, the Android sibling of the iTunes-search rank in `../rankCheck.ts` and
 * the ranking-parity gap called out in `ranking-features/08`. Distinct from the
 * category CHART rank (`playChartRank.ts`): a search position answers "where do I
 * rank for <term>", a chart position answers "where do I rank in <category>".
 * They must never be conflated.
 *
 * Two honesty facts make Play search rank HARDER than iOS (data-map §0, Open-Q4):
 *   • the only keyless route is scraping `play.google.com/store/search`, which
 *     429s from a Worker's datacenter egress — so the source is degrade-safe and
 *     an unreadable result is `null` UNKNOWN, never a fabricated position; and
 *   • Play personalizes search harder than the App Store, so a single integer
 *     position is lower-confidence. We therefore also expose a coarse BUCKET
 *     (top 3 / 10 / 20 / 50) and lead with it — false precision is dishonest.
 *
 * Pure computation + finding behind an injected `PlaySearchSource` (the concrete
 * scraper lives in `playSearchSource.ts`); unit-tests with zero network.
 */
import { type Finding, mk } from "../findings/core.js";

/** The injected keyless search source: ordered package ids for a (term, country). */
export type PlaySearchSource = (opts: {
  term: string;
  country: string;
  limit?: number;
}) => Promise<string[]>;

/** Coarse position bucket — the honest unit when personalization noise is high. */
export type PlaySearchBucket = "top3" | "top10" | "top20" | "top50" | "beyond50";

export type PlaySearchRankMeta = { term: string; country: string };

export type PlaySearchRank = PlaySearchRankMeta & {
  /** how many results we actually read (the depth we saw). */
  outOf: number;
} & ({ ranked: true; position: number; bucket: PlaySearchBucket } | { ranked: false });

/** Map a 1-based position to its coarse bucket. */
export function searchBucket(position: number): PlaySearchBucket {
  if (position <= 3) return "top3";
  if (position <= 10) return "top10";
  if (position <= 20) return "top20";
  if (position <= 50) return "top50";
  return "beyond50";
}

const BUCKET_LABEL: Record<PlaySearchBucket, string> = {
  top3: "top 3",
  top10: "top 10",
  top20: "top 20",
  top50: "top 50",
  beyond50: "beyond the top 50",
};

/** Pure: locate `packageName` in an ordered id list and shape the PlaySearchRank. */
export function playSearchRankFromEntries(
  entries: string[],
  packageName: string,
  meta: PlaySearchRankMeta,
): PlaySearchRank {
  const base = { term: meta.term, country: meta.country, outOf: entries.length };
  const idx = entries.indexOf(packageName);
  if (idx < 0) return { ...base, ranked: false };
  const position = idx + 1;
  return { ...base, ranked: true, position, bucket: searchBucket(position) };
}

/**
 * Fetch the search results via the injected source and locate the app. Returns a
 * PlaySearchRank on a good read, or `null` when the results are unreadable/empty
 * (UNKNOWN — never a false "not ranking"). Degrade-safe: a throwing source → null.
 */
export async function fetchPlaySearchRank(
  source: PlaySearchSource,
  opts: { packageName: string; term: string; country?: string; limit?: number },
): Promise<PlaySearchRank | null> {
  const term = opts.term.trim();
  if (!term) return null;
  const country = opts.country ?? "us";
  const limit = opts.limit ?? 50;
  let entries: string[];
  try {
    entries = await source({ term, country, limit });
  } catch {
    return null;
  }
  if (!Array.isArray(entries) || entries.length === 0) return null; // UNKNOWN
  return playSearchRankFromEntries(entries, opts.packageName, { term, country });
}

const SURFACE = "searchRank";

/**
 * A finding for a measured search position. Leads with the BUCKET (honest given
 * personalization noise) and includes the exact position as evidence. "Not in the
 * top N we read" is also an honest measured fact. UNKNOWN (`null`) → nothing. Pure.
 */
export function playSearchRankFinding(rank: PlaySearchRank | null): Finding[] {
  if (rank === null) return [];
  const where = `"${rank.term}" (${rank.country.toUpperCase()})`;
  if (rank.ranked) {
    return [
      mk({
        id: "play_search_rank",
        surface: SURFACE,
        severity: rank.position <= 10 ? "good" : "info",
        impact: "ranking",
        title: `In the ${BUCKET_LABEL[rank.bucket]} for ${where} on Google Play`,
        detail: `A measured organic search position (#${rank.position} of the top ${rank.outOf} we read). Play personalizes search, so treat the bucket as the reliable signal and the exact number as approximate.`,
        fix: "",
        evidence: `#${rank.position} of ${rank.outOf} — ${BUCKET_LABEL[rank.bucket]}`,
        context: true,
      }),
    ];
  }
  return [
    mk({
      id: "play_search_not_ranking",
      surface: SURFACE,
      severity: "info",
      impact: "ranking",
      title: `Not in the top ${rank.outOf} for ${where}`,
      detail: "We read the Play search results and didn't find this app in them — a measured fact, not an estimate.",
      fix: "",
      evidence: `outside top ${rank.outOf}`,
      context: true,
    }),
  ];
}
