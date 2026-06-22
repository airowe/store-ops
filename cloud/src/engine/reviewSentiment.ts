/**
 * Review sentiment + topic extraction — PRD 03 (`docs/prd/03-review-sentiment.md`)
 * / issue #95.
 *
 * Pulls an app's PUBLIC App Store reviews via Apple's free RSS customer-reviews
 * JSON feed (no key) and shapes them into an honest sentiment read + ranked
 * topics + review-derived keyword candidates.
 *
 * HONESTY DISCIPLINE (#78):
 *  - We ALWAYS carry the sample size `n`.
 *  - Below MIN_CONFIDENT_SAMPLE (20) we SUPPRESS the numeric score (`score:null`),
 *    flag `confidence:'low'`, and substitute an honest "too few reviews to
 *    summarize reliably" note — never a confident number off a tiny sample.
 *  - Topic counts are OBSERVED in-sample review frequencies, NEVER extrapolated
 *    to "% of all users".
 *  - Sentiment is GROUNDED in real review text: the injected reasoner's topics
 *    are reconciled against the actual review words, and on any reasoner
 *    error/garbage we degrade to a deterministic star-rating baseline. We never
 *    fabricate sentiment.
 *  - Review-derived keyword candidates are explicitly labeled `source:'reviews'`
 *    so they can never be confused with measured search volume.
 *
 * PURE + INJECTABLE: the fetch is a `FetchFn` and the reasoner is injected
 * (`Reasoner | undefined`), so the whole module unit-tests without a network or
 * a live model. Resilient like competitorWatch — `fetchReviews` returns [] on any
 * failure and NEVER throws.
 */
import { buildReviewsRssUrl, ITUNES_LOOKUP_URL } from "./constants.js";
import { asResponse, buildUrl, type FetchFn, fetchJson } from "./itunes.js";

/** The LLM-facing interface — provider-agnostic so tests inject a fake. */
export type Reasoner = (prompt: string) => Promise<string>; // returns raw model text

/** A single public App Store review, normalized from the RSS JSON feed. */
export type Review = {
  id: string;
  author: string;
  /** 1–5 stars, or null when the feed omitted/garbled it. */
  rating: number | null;
  title: string;
  content: string;
  version: string;
  country: string;
};

export type TopicSentiment = "positive" | "negative" | "mixed" | "neutral";

/** A ranked review theme — counts are OBSERVED in-sample frequencies. */
export type Topic = {
  topic: string;
  /** number of reviews in the SAMPLE that mention this topic (never extrapolated). */
  count: number;
  sentiment: TopicSentiment;
  /** verbatim slices of real review text — never invented. */
  sampleQuotes: string[];
};

export type ReviewSentiment = {
  /** the sample size — ALWAYS carried, shown in copy. */
  n: number;
  /** 0–100 overall sentiment score, or null when SUPPRESSED (n < threshold). */
  score: number | null;
  confidence: "low" | "ok";
  /** human one-liner, e.g. "mostly positive" or the low-sample note. */
  label: string;
  /** present only when there's something honest to add (e.g. the low-sample note). */
  note?: string | undefined;
  topics: Topic[];
};

/** A keyword candidate derived from REVIEW text — labeled so it's never confused
 *  with measured search volume. */
export type ReviewKeywordCandidate = {
  keyword: string;
  /** in-sample review frequency for this term. */
  count: number;
  source: "reviews";
};

/** Below this sample size we suppress a confident numeric score (#78). */
export const MIN_CONFIDENT_SAMPLE = 20;

// ── Feed parsing ─────────────────────────────────────────────────────────────

/** Unwrap Apple's `{ label: "..." }` value wrapper (or a bare string). */
function label(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "label" in v) {
    const l = (v as { label?: unknown }).label;
    if (typeof l === "string") return l;
  }
  return "";
}

/** Coerce a star-rating label to a 1–5 number, or null when absent/garbled. */
function coerceRating(v: unknown): number | null {
  const raw = label(v).trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Normalize the feed's `entry` field to an array (single object → [object]). */
function entriesOf(feed: unknown): unknown[] {
  if (!feed || typeof feed !== "object") return [];
  const entry = (feed as { entry?: unknown }).entry;
  if (Array.isArray(entry)) return entry;
  if (entry && typeof entry === "object") return [entry];
  return [];
}

/** Map one raw RSS entry to a Review, or null when it isn't a real review row. */
function entryToReview(raw: unknown, country: string): Review | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rating = coerceRating(o["im:rating"]);
  const content = label(o.content);
  // A real review row carries a rating AND content. The app-metadata entry has
  // neither — this also drops malformed rows.
  if (rating === null || !content.trim()) return null;
  const author = (() => {
    const a = o.author;
    if (a && typeof a === "object" && "name" in a) return label((a as { name?: unknown }).name);
    return "";
  })();
  return {
    id: label(o.id),
    author,
    rating,
    title: label(o.title),
    content,
    version: label(o["im:version"]),
    country,
  };
}

/**
 * Parse a customer-reviews RSS JSON feed into Review[]. PURE + resilient:
 *  - SKIPS the first feed entry (it's APP METADATA, not a review).
 *  - tolerates `entry` being a single object (1 item) or absent (0 items).
 *  - drops malformed rows (no rating / no content) rather than throwing.
 */
export function parseReviewsFeed(data: unknown, country = "us"): Review[] {
  if (!data || typeof data !== "object") return [];
  const feed = (data as { feed?: unknown }).feed;
  const entries = entriesOf(feed);
  // The FIRST entry is app metadata, never a review — skip it.
  const reviewEntries = entries.slice(1);
  const out: Review[] = [];
  for (const e of reviewEntries) {
    const r = entryToReview(e, country);
    if (r) out.push(r);
  }
  return out;
}

// ── Fetch ────────────────────────────────────────────────────────────────────

export type FetchReviewsOptions = {
  country?: string;
  /** how many feed pages to pull (bounded; default 1). */
  pages?: number;
  /** cap on total reviews returned across pages (default 200). */
  maxReviews?: number;
};

/**
 * Fetch PUBLIC reviews for an app (by numeric App Store track id) across a small,
 * bounded number of pages. Resilient like competitorWatch: a fetch/parse failure
 * on ANY page ends pagination and returns whatever we have — it NEVER throws, so
 * a read limitation degrades to "no reviews found" rather than an error.
 */
export async function fetchReviews(
  fetchFn: FetchFn,
  appId: string,
  { country = "us", pages = 1, maxReviews = 200 }: FetchReviewsOptions = {},
): Promise<Review[]> {
  const out: Review[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= Math.max(1, pages); page++) {
    let pageReviews: Review[];
    try {
      const url = buildReviewsRssUrl(appId, { country, page });
      const data = await fetchJson(fetchFn, url);
      pageReviews = parseReviewsFeed(data, country);
    } catch {
      break; // treat any page failure as end-of-data; never surface an error.
    }
    if (pageReviews.length === 0) break; // exhausted the feed.
    for (const r of pageReviews) {
      const key = r.id || `${r.author}|${r.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= maxReviews) return out;
    }
  }
  return out;
}

/**
 * Resolve an app's numeric App Store track id from its `bundleId` (via the free
 * iTunes Lookup endpoint), then fetch its PUBLIC reviews — the RSS reviews feed
 * is keyed by the numeric id, while the rest of the run carries the bundle id.
 * Resilient like everything here: a lookup/fetch failure (or an unknown bundle)
 * returns [] and NEVER throws, so a read limitation degrades honestly to
 * "no reviews found" rather than stranding the run.
 */
export async function fetchReviewsForBundle(
  fetchFn: FetchFn,
  bundleId: string,
  opts: FetchReviewsOptions = {},
): Promise<Review[]> {
  let trackId: string | null = null;
  try {
    const url = buildUrl(ITUNES_LOOKUP_URL, { bundleId, country: opts.country ?? "us" });
    const data = asResponse(await fetchJson(fetchFn, url));
    const tid = data.results?.[0]?.trackId;
    trackId = tid ? String(tid) : null;
  } catch {
    return [];
  }
  if (!trackId) return [];
  return fetchReviews(fetchFn, trackId, opts);
}

// ── Topic extraction (observed-frequency, deterministic) ─────────────────────

/** Generic words that never make a useful topic/keyword (store/marketing filler). */
const STOP = new Set([
  "the", "and", "for", "with", "your", "you", "our", "app", "apps", "this", "that",
  "but", "not", "are", "was", "have", "has", "had", "all", "any", "can", "get",
  "its", "out", "use", "very", "just", "really", "would", "could", "they", "them",
  "from", "what", "when", "will", "been", "their", "there", "much", "more", "most",
  "some", "than", "then", "into", "only", "even", "also", "love", "like", "great",
  "good", "best", "nice", "well", "ever", "still", "now", "new", "one", "make",
]);

/** Lowercase word-tokens (letters/digits only, length ≥ 3, non-stop). */
function tokens(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Average star rating over reviews that carry one, or null when none do. */
function avgRating(reviews: Review[]): number | null {
  const rated = reviews.filter((r) => r.rating !== null) as Array<Review & { rating: number }>;
  if (rated.length === 0) return null;
  return rated.reduce((s, r) => s + r.rating, 0) / rated.length;
}

/** Map a topic's mean star rating to a coarse sentiment label. */
function sentimentForReviews(reviews: Review[]): TopicSentiment {
  const avg = avgRating(reviews);
  if (avg === null) return "neutral";
  if (avg >= 4) return "positive";
  if (avg <= 2.5) return "negative";
  return "mixed";
}

/**
 * Extract ranked topics from the SAMPLE. `count` is the number of reviews that
 * mention the term (IN-SAMPLE frequency, never extrapolated), and quotes are
 * verbatim slices of real review text. Ranked by count desc, then alphabetically.
 */
export function extractTopics(reviews: Review[], { maxTopics = 8 }: { maxTopics?: number } = {}): Topic[] {
  // term → the reviews that mention it (dedup per review so the count is a
  // review frequency, not a raw word count).
  const byTerm = new Map<string, Review[]>();
  for (const r of reviews) {
    const terms = new Set(tokens(`${r.title} ${r.content}`));
    for (const t of terms) {
      if (!byTerm.has(t)) byTerm.set(t, []);
      byTerm.get(t)!.push(r);
    }
  }

  const topics: Topic[] = [];
  for (const [topic, group] of byTerm) {
    const quotes: string[] = [];
    for (const r of group) {
      const snippet = r.content.trim();
      if (snippet && !quotes.includes(snippet)) quotes.push(snippet);
      if (quotes.length >= 3) break;
    }
    topics.push({
      topic,
      count: group.length,
      sentiment: sentimentForReviews(group),
      sampleQuotes: quotes,
    });
  }

  topics.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0;
  });
  return topics.slice(0, maxTopics);
}

// ── Keyword candidates (review-sourced, labeled) ─────────────────────────────

/**
 * Review-derived keyword candidates, each labeled `source:'reviews'` so they're
 * never confused with measured search volume. Terms come ONLY from real review
 * text; `count` is the in-sample review frequency.
 */
export function reviewKeywordCandidates(
  reviews: Review[],
  { max = 20 }: { max?: number } = {},
): ReviewKeywordCandidate[] {
  return extractTopics(reviews, { maxTopics: max }).map((t) => ({
    keyword: t.topic,
    count: t.count,
    source: "reviews" as const,
  }));
}

// ── Reasoner grounding ───────────────────────────────────────────────────────

/** The strict JSON shape we ask the model for. */
type ModelShape = { label?: unknown; topics?: unknown };

/** Extract the first balanced JSON object from raw model text, or null. */
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Build the model prompt: summarize sentiment + extract topics, GROUNDED in the
 * supplied review snippets. The reconciler guardrails the output regardless, but
 * a tight prompt keeps the model honest in the first place.
 */
export function buildReviewsPrompt(reviews: Review[], { maxSnippets = 40 }: { maxSnippets?: number } = {}): string {
  const snippets = reviews
    .slice(0, maxSnippets)
    .map((r) => `- (${r.rating ?? "?"}★) ${r.content.replace(/\s+/g, " ").trim()}`)
    .join("\n");
  return [
    "You are an App Store review analyst. Summarize the sentiment of these PUBLIC",
    "user reviews and extract the recurring topics — using ONLY what the reviews say.",
    "",
    "Reviews:",
    snippets,
    "",
    "Rules:",
    "- Derive topics ONLY from words that appear in the reviews. Do NOT invent themes.",
    "- Each topic's sentiment is one of: positive | negative | mixed | neutral.",
    "",
    'Return ONLY JSON: {"label":"<one-line summary>","topics":[{"topic":"...","sentiment":"..."}]}',
  ].join("\n");
}

/**
 * GUARDRAIL the model's topics against the real review text: a topic word that
 * doesn't appear in any review is a hallucination and is DROPPED. The model's
 * sentiment is advisory; we re-derive `count` + quotes from the actual sample so
 * counts stay observed-in-sample. Throws on unparseable output (caught upstream).
 */
function reconcileReasonedTopics(rawModelText: string, reviews: Review[]): { label: string; topics: Topic[] } {
  const parsed = extractJson(rawModelText) as ModelShape | null;
  if (!parsed || typeof parsed !== "object") throw new Error("model output did not parse");

  const label = typeof parsed.label === "string" ? parsed.label.trim() : "";
  const modelTopics = Array.isArray(parsed.topics) ? parsed.topics : null;
  if (!modelTopics) throw new Error("model output missing topics");

  const out: Topic[] = [];
  const seen = new Set<string>();
  for (const t of modelTopics) {
    if (!t || typeof t !== "object") continue;
    const term = String((t as { topic?: unknown }).topic ?? "").toLowerCase().trim();
    if (!term || seen.has(term)) continue;
    // Anti-invention: every word of the topic must appear in some review.
    const words = tokens(term);
    if (words.length === 0) continue;
    const mentioning = reviews.filter((r) => {
      const hay = `${r.title} ${r.content}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    if (mentioning.length === 0) continue; // hallucinated → drop, never ship.
    seen.add(term);
    out.push({
      topic: term,
      count: mentioning.length, // observed in-sample, re-derived (not the model's word).
      sentiment: sentimentForReviews(mentioning),
      sampleQuotes: mentioning.slice(0, 3).map((r) => r.content.trim()).filter(Boolean),
    });
  }
  if (out.length === 0) throw new Error("no grounded topics survived");
  out.sort((a, b) => (a.count !== b.count ? b.count - a.count : a.topic < b.topic ? -1 : 1));
  return { label, topics: out };
}

// ── analyzeSentiment ─────────────────────────────────────────────────────────

/** Deterministic 0–100 score from the mean star rating ((avg-1)/4*100). */
function deterministicScore(reviews: Review[]): number | null {
  const avg = avgRating(reviews);
  if (avg === null) return null;
  return Math.round(((avg - 1) / 4) * 100);
}

/** A coarse human label from a 0–100 score. */
function labelForScore(score: number): string {
  if (score >= 75) return "mostly positive";
  if (score >= 50) return "mixed";
  return "mostly negative";
}

/**
 * Overall sentiment read for an app's reviews. PURE shaping (deterministic star
 * baseline + topics) with an OPTIONAL injected reasoner for grounded topic/
 * sentiment enrichment.
 *
 *  - n < MIN_CONFIDENT_SAMPLE → SUPPRESS the score (`score:null`),
 *    `confidence:'low'`, honest "too few reviews to summarize reliably" note (#78).
 *  - reasoner injected + guarded: on error/garbage we degrade to the deterministic
 *    summary; a hallucinated topic is dropped. Never throws, never fabricates.
 */
export async function analyzeSentiment(reviews: Review[], reasoner?: Reasoner): Promise<ReviewSentiment> {
  const n = reviews.length;

  // Deterministic baseline topics (also the fallback when the reasoner fails).
  let label = "";
  let topics = extractTopics(reviews);
  if (reasoner && n > 0) {
    try {
      const grounded = reconcileReasonedTopics(await reasoner(buildReviewsPrompt(reviews)), reviews);
      label = grounded.label;
      if (grounded.topics.length > 0) topics = grounded.topics;
    } catch {
      // degrade to the deterministic summary — never throw, never fabricate.
    }
  }

  // #78: below the sample threshold, suppress a confident numeric score.
  if (n < MIN_CONFIDENT_SAMPLE) {
    const note = `too few reviews to summarize reliably (n=${n})`;
    return {
      n,
      score: null,
      confidence: "low",
      label: label || note,
      note,
      topics,
    };
  }

  const score = deterministicScore(reviews);
  return {
    n,
    score,
    confidence: "ok",
    label: label || (score !== null ? labelForScore(score) : "unrated"),
    topics,
  };
}
