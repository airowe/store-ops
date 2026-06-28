import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FetchFn, __setSleep } from "../itunes.js";
import {
  PlayError,
  fetchText,
  playDetailUrl,
  playSearchUrl,
  playWebSource,
} from "./playWebSource.js";

// No real timers in the retry tests.
beforeAll(() => __setSleep(async () => {}));
afterAll(() => __setSleep(async (ms) => new Promise((r) => setTimeout(r, ms))));

/** Build a FetchFn that returns a scripted sequence of responses, recording URLs. */
function scriptedFetch(
  responses: Array<{ ok: boolean; status: number; body?: string; retryAfter?: string }>,
): { fetchFn: FetchFn; urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const fetchFn: FetchFn = async (url) => {
    urls.push(url);
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: r!.ok,
      status: r!.status,
      headers: { get: (n: string) => (n === "Retry-After" ? (r!.retryAfter ?? null) : null) },
      text: async () => r!.body ?? "",
    };
  };
  return { fetchFn, urls };
}

describe("Play page URL builders", () => {
  it("builds a detail URL with id/gl/hl", () => {
    const url = playDetailUrl("com.spotify.music", { country: "GB", lang: "en" });
    expect(url).toContain("play.google.com/store/apps/details");
    expect(url).toContain("id=com.spotify.music");
    expect(url).toContain("gl=GB");
    expect(url).toContain("hl=en");
  });

  it("defaults country/lang to US/en", () => {
    expect(playDetailUrl("com.x")).toContain("gl=US");
    expect(playDetailUrl("com.x")).toContain("hl=en");
  });

  it("builds a search URL scoped to apps (c=apps)", () => {
    const url = playSearchUrl("meditation");
    expect(url).toContain("play.google.com/store/search");
    expect(url).toContain("q=meditation");
    expect(url).toContain("c=apps");
  });
});

describe("fetchText", () => {
  it("returns the body on a 200", async () => {
    const { fetchFn } = scriptedFetch([{ ok: true, status: 200, body: "<html>ok</html>" }]);
    expect(await fetchText(fetchFn, "https://x")).toBe("<html>ok</html>");
  });

  it("retries a 403 (datacenter egress) and succeeds on the next attempt", async () => {
    const { fetchFn, urls } = scriptedFetch([
      { ok: false, status: 403 },
      { ok: true, status: 200, body: "<html>after-retry</html>" },
    ]);
    expect(await fetchText(fetchFn, "https://x")).toBe("<html>after-retry</html>");
    expect(urls.length).toBe(2); // retried once
  });

  it("throws a PlayError on a non-retryable status (404)", async () => {
    const { fetchFn } = scriptedFetch([{ ok: false, status: 404 }]);
    await expect(fetchText(fetchFn, "https://x")).rejects.toBeInstanceOf(PlayError);
  });

  it("playWebSource.detail hits the detail URL", async () => {
    const { fetchFn, urls } = scriptedFetch([{ ok: true, status: 200, body: "ok" }]);
    await playWebSource(fetchFn).detail("com.spotify.music");
    expect(urls[0]).toContain("/store/apps/details");
    expect(urls[0]).toContain("id=com.spotify.music");
  });
});
