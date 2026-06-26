import { beforeEach, describe, expect, it } from "vitest";
import {
  MIN_CONFIDENT_SAMPLE,
  type Reasoner,
  type Review,
  analyzeSentiment,
  buildReviewsPrompt,
  extractTopics,
  fetchReviews,
  fetchReviewsForBundle,
  parseReviewsFeed,
  reviewKeywordCandidates,
} from "./reviewSentiment.js";
import { __setSleep, type FetchFn } from "./itunes.js";

// Never actually sleep in tests (backoff is exercised by call counts elsewhere).
beforeEach(() => __setSleep(async () => {}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** One Apple RSS `entry` row (label-wrapped, like the real JSON feed). */
function entry(over: {
  id?: string;
  rating?: string;
  title?: string;
  content?: string;
  author?: string;
  version?: string;
}): unknown {
  return {
    id: { label: over.id ?? "1" },
    "im:rating": { label: over.rating ?? "5" },
    "im:version": { label: over.version ?? "1.0" },
    title: { label: over.title ?? "Great" },
    content: { label: over.content ?? "Love it" },
    author: { name: { label: over.author ?? "Reviewer" } },
  };
}

/** The first feed entry is APP METADATA (no im:rating), not a review. */
const APP_METADATA_ENTRY = {
  "im:name": { label: "Demo App" },
  id: { label: "https://apps.apple.com/us/app/id123" },
  title: { label: "Demo App" },
};

/** Build a full RSS customerreviews JSON feed body string. */
function feedBody(entries: unknown[], opts: { withMetadata?: boolean } = {}): string {
  const all = opts.withMetadata === false ? entries : [APP_METADATA_ENTRY, ...entries];
  return JSON.stringify({ feed: { entry: all } });
}

/** A mock FetchFn that returns the given body with status 200. */
function okFetch(body: string): FetchFn {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => body,
  });
}

/** A fake reasoner that always returns the same canned model text. */
const fakeReasoner =
  (canned: string): Reasoner =>
  async () =>
    canned;

// ── parseReviewsFeed ─────────────────────────────────────────────────────────

describe("parseReviewsFeed — RSS JSON → Review[]", () => {
  it("skips the first (app-metadata) entry and maps label-wrapped fields", () => {
    const data = JSON.parse(
      feedBody([
        entry({ id: "10", rating: "5", title: "Best", content: "amazing app", author: "Ann" }),
        entry({ id: "11", rating: "2", title: "Meh", content: "buggy lately", author: "Bob" }),
      ]),
    );
    const reviews = parseReviewsFeed(data);
    // app-metadata entry dropped → exactly the 2 reviews.
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({ id: "10", rating: 5, title: "Best", content: "amazing app", author: "Ann" });
    expect(reviews[1]).toMatchObject({ id: "11", rating: 2, content: "buggy lately" });
    // im:rating is coerced to a NUMBER, not left as a string.
    expect(typeof reviews[0]?.rating).toBe("number");
  });

  it("tolerates a single-review feed where `entry` is a lone object (not an array)", () => {
    // Apple returns `entry` as a single object when exactly one item exists.
    const single = { feed: { entry: entry({ id: "99", rating: "4", content: "solid" }) } };
    const reviews = parseReviewsFeed(single);
    // The lone object is treated as app metadata (first entry) → zero reviews,
    // never a throw. (When only metadata exists, there are no reviews.)
    expect(reviews).toEqual([]);
  });

  it("returns [] without throwing when `entry` is absent (zero reviews)", () => {
    expect(parseReviewsFeed({ feed: {} })).toEqual([]);
    expect(parseReviewsFeed({})).toEqual([]);
    expect(parseReviewsFeed(null)).toEqual([]);
  });

  it("drops malformed rows (missing rating/content) rather than emitting junk", () => {
    const data = {
      feed: {
        entry: [
          APP_METADATA_ENTRY,
          entry({ id: "1", rating: "5", content: "ok" }),
          { id: { label: "2" } }, // no rating, no content → malformed
        ],
      },
    };
    const reviews = parseReviewsFeed(data);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.id).toBe("1");
  });
});

// ── fetchReviews ─────────────────────────────────────────────────────────────

describe("fetchReviews — resilient public RSS fetch", () => {
  it("parses a real RSS fixture body into Review[]", async () => {
    const body = feedBody([
      entry({ id: "1", rating: "5", content: "love this" }),
      entry({ id: "2", rating: "3", content: "okay" }),
    ]);
    const reviews = await fetchReviews(okFetch(body), "123456", { pages: 1 });
    expect(reviews.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("returns [] (never throws) when the FetchFn rejects", async () => {
    const boom: FetchFn = async () => {
      throw new Error("network down");
    };
    await expect(fetchReviews(boom, "123456", { pages: 1 })).resolves.toEqual([]);
  });

  it("returns [] (never throws) on a non-OK / unparseable body", async () => {
    const bad: FetchFn = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "<<<not json>>>",
    });
    await expect(fetchReviews(bad, "123456", { pages: 1 })).resolves.toEqual([]);
  });

  it("caps total reviews at maxReviews across pages", async () => {
    const body = feedBody([
      entry({ id: "1", rating: "5", content: "a" }),
      entry({ id: "2", rating: "5", content: "b" }),
      entry({ id: "3", rating: "5", content: "c" }),
    ]);
    const reviews = await fetchReviews(okFetch(body), "123456", { pages: 3, maxReviews: 2 });
    expect(reviews).toHaveLength(2);
  });
});

// ── fetchReviewsForBundle (resolve bundleId → trackId, then fetch) ────────────

describe("fetchReviewsForBundle — bundleId → trackId → reviews", () => {
  /** A FetchFn that answers the iTunes lookup with a trackId, the RSS feed with reviews. */
  function lookupThenFeed(trackId: number | null, feed: string): FetchFn {
    return async (url: string) => {
      const body = url.includes("/lookup")
        ? JSON.stringify({ resultCount: trackId === null ? 0 : 1, results: trackId === null ? [] : [{ trackId }] })
        : feed;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => body };
    };
  }

  it("resolves the numeric track id from the bundle id and returns its reviews", async () => {
    const feed = feedBody([entry({ id: "1", rating: "5", content: "love this" })]);
    const reviews = await fetchReviewsForBundle(lookupThenFeed(123456, feed), "com.demo.app");
    expect(reviews.map((r) => r.id)).toEqual(["1"]);
  });

  it("returns [] (never throws) when the bundle id resolves to no app", async () => {
    const feed = feedBody([entry({ id: "1", rating: "5", content: "x" })]);
    await expect(fetchReviewsForBundle(lookupThenFeed(null, feed), "com.missing")).resolves.toEqual([]);
  });

  it("returns [] (never throws) when the lookup itself fails", async () => {
    const boom: FetchFn = async () => {
      throw new Error("network down");
    };
    await expect(fetchReviewsForBundle(boom, "com.demo.app")).resolves.toEqual([]);
  });
});

// ── extractTopics ────────────────────────────────────────────────────────────

function review(over: Partial<Review> & { content: string }): Review {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    author: over.author ?? "A",
    rating: over.rating ?? 5,
    title: over.title ?? "",
    content: over.content,
    version: over.version ?? "1.0",
    country: over.country ?? "us",
  };
}

describe("extractTopics — observed-frequency ranking", () => {
  it("ranks topics by in-sample frequency (count desc) with verbatim quotes", () => {
    const reviews = [
      review({ content: "the sync feature is broken and sync fails" }),
      review({ content: "sync keeps failing for me" }),
      review({ content: "battery drain is terrible" }),
    ];
    const topics = extractTopics(reviews);
    const sync = topics.find((t) => t.topic === "sync");
    const battery = topics.find((t) => t.topic === "battery");
    expect(sync).toBeDefined();
    // "sync" appears in 2 reviews → count is the IN-SAMPLE review frequency.
    expect(sync?.count).toBe(2);
    expect(battery?.count).toBe(1);
    // ranked sync (2) before battery (1).
    expect(topics.indexOf(sync!)).toBeLessThan(topics.indexOf(battery!));
    // quotes are VERBATIM slices of real review text, never invented.
    expect(sync?.sampleQuotes.length).toBeGreaterThan(0);
    for (const q of sync!.sampleQuotes) {
      expect(reviews.some((r) => r.content.includes(q))).toBe(true);
    }
  });

  it("counts are sample frequencies, never extrapolated past the sample size", () => {
    const reviews = [review({ content: "crash crash crash on launch" })];
    const topics = extractTopics(reviews);
    const crash = topics.find((t) => t.topic === "crash");
    // Even though "crash" appears 3x in one review, the count is 1 (one review).
    expect(crash?.count).toBeLessThanOrEqual(reviews.length);
  });
});

// ── analyzeSentiment — honesty guardrails (#78) ──────────────────────────────

describe("analyzeSentiment — low-sample suppression", () => {
  it("MIN_CONFIDENT_SAMPLE is 20", () => {
    expect(MIN_CONFIDENT_SAMPLE).toBe(20);
  });

  it("SUPPRESSES the numeric score and flags low confidence when n < 20", async () => {
    const reviews = Array.from({ length: 5 }, (_, i) =>
      review({ id: String(i), content: "great app", rating: 5 }),
    );
    const out = await analyzeSentiment(reviews);
    expect(out.n).toBe(5);
    // The #78 invariant: no confident number off a tiny sample.
    expect(out.score).toBeNull();
    expect(out.confidence).toBe("low");
    expect(out.note).toMatch(/too few reviews/i);
  });

  it("returns a non-null score and carries n when n >= 20", async () => {
    const reviews = Array.from({ length: 22 }, (_, i) =>
      review({ id: String(i), content: "great app", rating: 5 }),
    );
    const out = await analyzeSentiment(reviews);
    expect(out.n).toBe(22);
    expect(out.score).not.toBeNull();
    expect(out.confidence).toBe("ok");
  });
});

describe("analyzeSentiment — reasoner grounding + fallback", () => {
  it("uses the injected reasoner's topic/sentiment output (grounded in text)", async () => {
    const reviews = Array.from({ length: 22 }, (_, i) =>
      review({ id: String(i), content: "the offline mode is fantastic", rating: 5 }),
    );
    const reasoner = fakeReasoner(
      JSON.stringify({
        label: "mostly positive",
        topics: [{ topic: "offline mode", sentiment: "positive" }],
      }),
    );
    const out = await analyzeSentiment(reviews, reasoner);
    // The reasoner's topic must be substantiated by REAL review text to survive.
    expect(out.topics.some((t) => t.topic === "offline mode")).toBe(true);
  });

  it("degrades to the deterministic star summary when the reasoner throws", async () => {
    const reviews = Array.from({ length: 22 }, (_, i) =>
      review({ id: String(i), content: "love it", rating: 5 }),
    );
    const throwing: Reasoner = async () => {
      throw new Error("model unavailable");
    };
    const out = await analyzeSentiment(reviews, throwing);
    // Never throws, never fabricates — still a deterministic, non-null read.
    expect(out.score).not.toBeNull();
    expect(out.label.length).toBeGreaterThan(0);
  });

  it("degrades to the deterministic summary when the reasoner returns garbage", async () => {
    const reviews = Array.from({ length: 22 }, (_, i) =>
      review({ id: String(i), content: "love it", rating: 5 }),
    );
    const out = await analyzeSentiment(reviews, fakeReasoner("not json at all"));
    expect(out.score).not.toBeNull();
  });

  it("never fabricates a reasoner topic absent from the review text", async () => {
    const reviews = Array.from({ length: 22 }, (_, i) =>
      review({ id: String(i), content: "the app is fast", rating: 5 }),
    );
    const reasoner = fakeReasoner(
      JSON.stringify({ label: "positive", topics: [{ topic: "cryptocurrency", sentiment: "positive" }] }),
    );
    const out = await analyzeSentiment(reviews, reasoner);
    expect(out.topics.some((t) => t.topic === "cryptocurrency")).toBe(false);
  });
});

// ── reviewKeywordCandidates ──────────────────────────────────────────────────

describe("reviewKeywordCandidates — review-sourced labeling", () => {
  it("labels every candidate source:'reviews' and derives terms from real text", () => {
    const reviews = [
      review({ content: "the budget tracker helps me save money" }),
      review({ content: "great budget app for saving" }),
    ];
    const candidates = reviewKeywordCandidates(reviews);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.source).toBe("reviews");
      // every candidate term must appear in the real review text.
      expect(reviews.some((r) => r.content.toLowerCase().includes(c.keyword))).toBe(true);
    }
    expect(candidates.some((c) => c.keyword === "budget")).toBe(true);
  });
});

describe("buildReviewsPrompt", () => {
  it("includes verbatim review snippets so the model is grounded", () => {
    const reviews = [review({ content: "dark mode please", rating: 3 })];
    const prompt = buildReviewsPrompt(reviews);
    expect(prompt).toContain("dark mode please");
  });
});
