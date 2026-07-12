/**
 * Deterministic keyword-intent clustering for the Custom Product Pages audit
 * (#154 Part 1). CPPs now surface in ORGANIC search (not just paid), and the
 * differentiated finding is "your tracked keywords span N distinct intents — one
 * candidate page each." Part 2's LLM plans the creative per intent; THIS is the
 * honest, deterministic count + naming the audit needs, no LLM.
 *
 * Honesty, load-bearing:
 *   • an "intent" here is a CLUSTER of the user's OWN tracked keywords sharing a
 *     significant term — it is MEASURED from their real targets, never invented,
 *     and each cluster's label is a real token from those keywords,
 *   • no keywords → no intents (the audit shows "?" / says nothing), never a
 *     fabricated count.
 *
 * Pure + deterministic: greedy most-frequent-token clustering, ties broken
 * alphabetically → the same keyword set always yields the identical clusters.
 */

/** A cluster of tracked keywords sharing a significant term. */
export type KeywordIntent = {
  /** the shared term the cluster is named by (a real token from the keywords). */
  label: string;
  /** the tracked keywords in this cluster (each assigned to exactly one intent). */
  keywords: string[];
};

/** Low-signal words that never make a good intent label. */
const STOPWORDS = new Set([
  "app", "apps", "free", "best", "the", "and", "for", "with", "your", "you",
  "pro", "plus", "lite", "new", "get", "top", "all", "any", "our", "this",
]);

/** Significant tokens of a keyword: length ≥ 3, not a stopword, lowercased. */
function tokensOf(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Cluster tracked keywords into named intents. Greedy: repeatedly take the
 * significant token shared by the most still-unclustered keywords (ties broken
 * alphabetically) and form an intent from every keyword that contains it. A
 * keyword sharing no significant token with any other becomes its own intent,
 * labelled by its first significant token (or the keyword itself as a fallback).
 *
 * Returns intents sorted by size desc, then label asc — fully deterministic.
 */
export function clusterKeywordIntents(keywords: string[]): KeywordIntent[] {
  // Normalize: trim, drop empties, de-dupe (case-insensitive, keep first spelling).
  // Keywords are matched case-insensitively in ASO, so normalize to lowercase —
  // this also makes clustering order-independent (same set → same output).
  const seen = new Set<string>();
  const remaining: string[] = [];
  for (const raw of keywords) {
    const kw = raw.trim().toLowerCase();
    if (!kw || seen.has(kw)) continue;
    seen.add(kw);
    remaining.push(kw);
  }

  const intents: KeywordIntent[] = [];
  const pool = new Set(remaining);

  while (pool.size > 0) {
    // Tally significant-token frequency across the still-unclustered keywords.
    const freq = new Map<string, number>();
    for (const kw of pool) {
      for (const t of new Set(tokensOf(kw))) freq.set(t, (freq.get(t) ?? 0) + 1);
    }

    // Pick the most-shared token (ties: alphabetical). No tokens at all → each
    // remaining keyword is its own intent labelled by itself.
    let bestToken = "";
    let bestCount = 0;
    for (const [t, c] of freq) {
      if (c > bestCount || (c === bestCount && (bestToken === "" || t < bestToken))) {
        bestToken = t;
        bestCount = c;
      }
    }

    if (bestToken === "") {
      // pool keywords have no significant tokens — label each by itself.
      for (const kw of [...pool].sort()) intents.push({ label: kw.toLowerCase(), keywords: [kw] });
      break;
    }

    const members = [...pool].filter((kw) => tokensOf(kw).includes(bestToken));
    // A lone keyword: prefer its OWN first significant token as the label over a
    // token that only it carries (keeps singletons named by their head term).
    const label = members.length === 1 ? (tokensOf(members[0]!)[0] ?? bestToken) : bestToken;
    intents.push({ label, keywords: members.sort() });
    for (const kw of members) pool.delete(kw);
  }

  return intents.sort((a, b) => b.keywords.length - a.keywords.length || a.label.localeCompare(b.label));
}
