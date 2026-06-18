/**
 * Keyword gap finder — PRD 01 (`docs/prd/ranking-features/01-keyword-gap.md`).
 *
 * A PURE, DETERMINISTIC, NETWORK-FREE function that fuses three data sources we
 * already capture — your live listing copy (ASC read or public), your organic
 * rank history, and tracked competitors' VISIBLE listings — into a sorted list
 * of `KeywordGap`s: terms competitors use that YOU don't target and don't rank
 * top-50 for, scored by winnability and flagged for keyword-field budget fit.
 *
 * HARD HONESTY DISCIPLINES (carried from the suite overview):
 *  - We infer term usage ONLY from a competitor's visible name/subtitle — NEVER
 *    from their ranking algorithm. The model says "competitors USE this term";
 *    it never claims "they rank #1 BECAUSE of it". No causal field exists here.
 *  - Privacy boundary: a `KeywordGap` carries competitor NAMES only — never the
 *    raw listing (no price/version/genres). The full `CompetitorListing` is read
 *    here but never echoed out.
 *  - Winnability over vanity volume: ties in base score are broken by
 *    REACHABILITY (how close you already are to the top-10), so a #200/weak app
 *    isn't sent to chase a high-volume incumbent term it can't reach. #06 deepens
 *    this with competitor-strength; here we weight your own distance-to-top-10.
 *  - `fitsBudget` is ADVISORY — the optimizer still enforces the 100-char limit.
 */
import { CHAR_LIMITS } from "./constants.js";
import type { Listing as CompetitorListing } from "./competitorWatch.js";
import { scoreKeyword as defaultScoreKeyword } from "./keywords.js";
import type { Rank } from "./rankCheck.js";

export type KeywordGap = {
  keyword: string;
  /** which tracked competitors use this term (derived from their name/subtitle). */
  competitorsUsing: string[];
  /** your current organic rank for this term, if any (from rank snapshots). */
  youRank: number | null;
  /** already present in your name/subtitle/keyword field? */
  inYourMetadata: boolean;
  /** winnability score (0–100); reachability breaks base-score ties on sort. */
  score: number;
  /** advisory: does it fit your remaining keyword-field char budget (~100)? */
  fitsBudget: boolean;
};

export type FindKeywordGapsInput = {
  /** your live copy: name, subtitle, keywords string (ASC read or public). */
  yourCopy: { name?: string | undefined; subtitle?: string | undefined; keywords?: string | undefined };
  /** your organic ranks for seed keywords (from rank snapshots). */
  yourRanks: Rank[];
  /** competitor listings (from competitorWatch.lookup/lookupAll). */
  competitors: CompetitorListing[];
  /**
   * Optional keyword scorer. Defaults to a neutral heuristic (we have no live
   * volume/difficulty/relevance for an inferred competitor term, so the default
   * leans on competitor frequency — the more rivals use it, the higher the base).
   */
  scoreKeyword?: ((keyword: string, volume: number, difficulty: number, relevance: number) => number) | undefined;
};

/** The term is "ranked" (not a gap) when you sit inside the top 50. */
const TOP_RANK_CUTOFF = 50;

/**
 * Generic English stopwords + ASO filler that never make useful keyword targets.
 * Kept small and explicit; case-folded at compare time.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "our", "app", "apps", "best",
  "free", "pro", "plus", "new", "now", "all", "any", "more", "get", "to",
  "of", "in", "on", "a", "an", "by", "or", "is", "it", "my", "me", "we",
  "everyone", "daily", "guided",
]);

/** Lower-case word tokens of a text blob (letters/digits only, length ≥ 3). */
function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** The set of word-tokens already present anywhere in your metadata (folded). */
function yourMetadataTokens(copy: FindKeywordGapsInput["yourCopy"]): Set<string> {
  const blob = [copy.name ?? "", copy.subtitle ?? "", copy.keywords ?? ""].join(" ");
  return new Set(tokenize(blob));
}

/** Your rank for a term (case-insensitive keyword match), or null if untracked. */
function rankFor(ranks: Rank[], keyword: string): number | null {
  const hit = ranks.find((r) => r.keyword.toLowerCase() === keyword);
  return hit ? hit.rank : null;
}

/**
 * Reachability weight in [0,1): how close you already are to the top-10 for this
 * term. Already near (rank just past the cutoff) → high; nowhere (null) → 0.
 * This is the "winnable, not just high-volume" tiebreak — a small, bounded nudge
 * that never reorders genuinely different base scores, only breaks ties.
 */
function reachability(youRank: number | null): number {
  if (youRank == null) return 0; // not on the board → least reachable
  // rank 11 → ~0.99, rank 200 → ~0.05. Monotonic decreasing, bounded < 1.
  return 10 / (youRank + 1);
}

/**
 * Find the keyword gaps. Pure + deterministic: same input → deep-equal output.
 * Degrades gracefully — no competitors (or all errored) yields an empty array,
 * and a malformed listing is skipped rather than throwing.
 */
export function findKeywordGaps(input: FindKeywordGapsInput): KeywordGap[] {
  const score = input.scoreKeyword ?? ((_kw, v, d, r) => defaultScoreKeyword({ keyword: _kw, volume: v, difficulty: d, relevance: r }));
  const mine = yourMetadataTokens(input.yourCopy);

  // 1. Gather every term each competitor visibly uses, with attribution.
  //    A competitor's OWN brand tokens (its name) are excluded — using your own
  //    name isn't a transferable keyword target. We collect from name+subtitle
  //    but treat the name tokens as that competitor's brand for exclusion.
  const usage = new Map<string, Set<string>>(); // term → set of competitor names
  for (const c of input.competitors) {
    if (!c || c.error || (!c.name && !c.subtitle)) continue;
    const brand = new Set(tokenize(c.name ?? ""));
    const terms = new Set([...tokenize(c.name ?? ""), ...tokenize(c.subtitle ?? "")]);
    for (const term of terms) {
      if (brand.has(term) && tokenize(c.name ?? "").length <= 1) continue; // pure brand word (e.g. "Calm")
      if (!usage.has(term)) usage.set(term, new Set());
      usage.get(term)!.add(c.name);
    }
  }

  // 2. Keep only genuine gaps: not in your metadata AND not ranked top-50.
  const remainingBudget = Math.max(0, CHAR_LIMITS.keywords - (input.yourCopy.keywords ?? "").length);

  const gaps: Array<KeywordGap & { _reach: number }> = [];
  for (const [keyword, competitorsSet] of usage) {
    const inYourMetadata = mine.has(keyword);
    const youRank = rankFor(input.yourRanks, keyword);
    const ranksTop = youRank != null && youRank <= TOP_RANK_CUTOFF;
    if (inYourMetadata || ranksTop) continue; // not a gap

    // Default heuristic inputs: more rivals using a term → higher volume proxy;
    // relevance neutral; difficulty neutral. A caller-supplied scorer overrides.
    const competitorsUsing = [...competitorsSet].sort();
    const volume = Math.min(100, 40 + competitorsUsing.length * 20);
    const base = score(keyword, volume, 50, 60);
    // +comma separator cost: a term needs its own length + 1 (unless field empty).
    const cost = keyword.length + (input.yourCopy.keywords ? 1 : 0);
    gaps.push({
      keyword,
      competitorsUsing,
      youRank,
      inYourMetadata,
      score: Math.round(base * 100) / 100,
      fitsBudget: cost <= remainingBudget,
      _reach: reachability(youRank),
    });
  }

  // 3. Sort: real gaps (not-in-metadata) first, then by score desc; ties broken
  //    by reachability (winnability), then alphabetically for determinism.
  gaps.sort((a, b) => {
    if (a.inYourMetadata !== b.inYourMetadata) return a.inYourMetadata ? 1 : -1;
    if (a.score !== b.score) return b.score - a.score;
    if (a._reach !== b._reach) return b._reach - a._reach;
    return a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0;
  });

  return gaps.map(({ _reach, ...g }) => g);
}
