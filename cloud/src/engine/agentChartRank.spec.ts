/**
 * runAgent must MEASURE the public category chart position (#455 wiring).
 *
 * `chartRank` has been a declared field on AgentResult, a persisted column, and
 * a consumer (`chartRankFindings`) for some time — with no producer. Nothing
 * ever assigned it, so `chart_rank_present` / `chart_rank_absent` returned []
 * on line one of every run. These tests pin the producer.
 *
 * The chart feed is KEYLESS, so this is measured on every run — keyed or not.
 */
import { describe, expect, it, vi } from "vitest";
import { runAgent, type AppInput } from "./agent.js";

const GENRE = "6013"; // Health & Fitness
const MY_ID = "555";

const baseInput = (): AppInput => ({
  app: "Acme",
  bundleId: "com.acme.app",
  keywords: [{ keyword: "habit", volume: 60, difficulty: 40, relevance: 80 }],
  competitors: [],
  previousCompetitors: {},
  country: "US",
});

/** A legacy top-charts RSS body carrying `ids` in chart order. */
const chartFeed = (ids: string[]) =>
  JSON.stringify({ feed: { entry: ids.map((id) => ({ id: { attributes: { "im:id": id } } })) } });

/**
 * Drive runAgent with a lookup that carries a trackId + genre, and a chart feed
 * containing `chartIds`. `opts.chartBody` overrides the feed for failure cases.
 */
function stubFetch(chartIds: string[], opts: { chartBody?: string; chartStatus?: number; genreId?: string | null } = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes("/lookup")) {
      const genreId = opts.genreId === null ? {} : { primaryGenreId: opts.genreId ?? GENRE };
      return new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              bundleId: "com.acme.app",
              trackName: "Acme",
              trackId: Number(MY_ID),
              ...genreId,
              primaryGenreName: "Health & Fitness",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/rss/")) {
      return new Response(opts.chartBody ?? chartFeed(chartIds), { status: opts.chartStatus ?? 200 });
    }
    return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
  });
}

describe("runAgent — the category chart is actually measured", () => {
  it("returns a MEASURED position when our app is in the chart", async () => {
    const fetchFn = stubFetch(["111", "222", MY_ID, "444"]);
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.chartRank).toBeDefined();
    expect(r.chartRank).toMatchObject({ ranked: true, position: 3, genreId: GENRE, outOf: 4 });
  });

  it("says ranked:false — read the chart, we're not in it — rather than staying silent", async () => {
    const fetchFn = stubFetch(["111", "222", "333"]);
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.chartRank).toMatchObject({ ranked: false, outOf: 3 });
  });

  it("narrows the measured rank onto audit.categoryRank for the status bar", async () => {
    const fetchFn = stubFetch(["111", MY_ID]);
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.audit.categoryRank).toEqual({ rank: 2, category: "Health & Fitness" });
  });

  it("carries categoryRank.rank = null when the chart was read and we're absent", async () => {
    // null means MEASURED-AND-ABSENT, which is different from unknown.
    const fetchFn = stubFetch(["111", "222"]);
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.audit.categoryRank?.rank).toBeNull();
  });

  it("passes the run's country through to the feed", async () => {
    const fetchFn = stubFetch([MY_ID]);
    await runAgent(fetchFn as never, { ...baseInput(), country: "GB" });
    const chartCall = fetchFn.mock.calls.map(String).find((u) => u.includes("/rss/"));
    expect(chartCall).toContain("/gb/");
    expect(chartCall).toContain(`genre=${GENRE}`);
  });

  it("leaves BOTH fields absent when the genre is unknown — never a false 'not charting'", async () => {
    const fetchFn = stubFetch([MY_ID], { genreId: null });
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.chartRank).toBeUndefined();
    expect(r.audit.categoryRank).toBeUndefined();
    // and it must not have spent a request on a chart it cannot pick
    expect(fetchFn.mock.calls.map(String).some((u) => u.includes("/rss/"))).toBe(false);
  });

  it(
    "leaves both fields absent on an unreadable feed (unknown, not zero)",
    async () => {
      // A body that won't parse throws inside fetchJson, which is the RETRYABLE
      // branch (itunes.ts) — so this deliberately outlives the 5s default while
      // backoff runs. Kept at full cost because a garbled feed is exactly the
      // case that must not become a false "not charting".
      const fetchFn = stubFetch([], { chartBody: "not json at all" });
      const r = await runAgent(fetchFn as never, baseInput());
      expect(r.chartRank).toBeUndefined();
      expect(r.audit.categoryRank).toBeUndefined();
    },
    20_000,
  );

  it("leaves both fields absent on an empty chart feed", async () => {
    const fetchFn = stubFetch([]);
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.chartRank).toBeUndefined();
    expect(r.audit.categoryRank).toBeUndefined();
  });

  it("never fails the whole run when the chart fetch throws", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/rss/")) throw new Error("network");
      if (url.includes("/lookup")) {
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [{ bundleId: "com.acme.app", trackName: "Acme", trackId: Number(MY_ID), primaryGenreId: GENRE }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
    });
    const r = await runAgent(fetchFn as never, baseInput());
    // the rest of the run still landed
    expect(r.audit.liveName).toBe("Acme");
    expect(r.chartRank).toBeUndefined();
  }, 20_000);
});
