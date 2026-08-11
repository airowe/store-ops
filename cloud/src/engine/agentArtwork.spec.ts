/**
 * The audit must carry OUR OWN app's icon (#455).
 *
 * The icon comparison measures your icon against the neighbour set's. The
 * neighbour half shipped in #468; this is the other half. Without it there is
 * nothing of ours to compare, and `resolveApp.iconUrl` is not it — that feeds
 * the app-picker UI and never reaches the audit.
 */
import { describe, expect, it, vi } from "vitest";
import { runAgent, type AppInput } from "./agent.js";

const baseInput = (): AppInput => ({
  app: "Acme",
  bundleId: "com.acme.app",
  keywords: [],
  competitors: [],
  previousCompetitors: {},
  country: "US",
});

/** A lookup carrying whatever artwork fields the case needs. */
const stubFetch = (listing: Record<string, unknown>) =>
  vi.fn(async (url: string) => {
    if (String(url).includes("/lookup")) {
      return new Response(
        JSON.stringify({ resultCount: 1, results: [{ bundleId: "com.acme.app", trackName: "Acme", ...listing }] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
  });

describe("runAgent — the audit carries our own icon", () => {
  it("carries the largest artwork the lookup returned", async () => {
    const fetchFn = stubFetch({
      artworkUrl512: "https://cdn.example/512.png",
      artworkUrl100: "https://cdn.example/100.png",
    });
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.audit.artworkUrl).toBe("https://cdn.example/512.png");
  });

  it("falls back to a smaller size rather than carrying nothing", async () => {
    const fetchFn = stubFetch({ artworkUrl60: "https://cdn.example/60.png" });
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.audit.artworkUrl).toBe("https://cdn.example/60.png");
  });

  it("leaves artworkUrl ABSENT when the lookup carried no artwork", async () => {
    const r = await runAgent(stubFetch({}) as never, baseInput());
    expect(r.audit.artworkUrl).toBeUndefined();
    expect("artworkUrl" in r.audit).toBe(false);
  });

  it("leaves it absent for a blank artwork url rather than carrying ''", async () => {
    // An unfetchable icon is UNMEASURED. A blank string would survive an
    // `if (url)` guard downstream and then fail the actual read.
    const r = await runAgent(stubFetch({ artworkUrl512: "" }) as never, baseInput());
    expect(r.audit.artworkUrl).toBeUndefined();
  });

  it("leaves it absent when the whole lookup is unreadable", async () => {
    const boom = vi.fn(async () => new Response("not json", { status: 200 }));
    const r = await runAgent(boom as never, baseInput());
    expect(r.audit.artworkUrl).toBeUndefined();
  }, 20_000);

  it("does not spend an extra request to get it", async () => {
    // It rides the lookup audit() already performs.
    const fetchFn = stubFetch({ artworkUrl512: "https://cdn.example/512.png" });
    await runAgent(fetchFn as never, baseInput());
    const lookups = fetchFn.mock.calls.map(String).filter((u) => u.includes("/lookup"));
    expect(lookups).toHaveLength(1);
  });
});
