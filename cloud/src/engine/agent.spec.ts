import { describe, expect, it } from "vitest";
import { runAgent } from "./agent.js";
import type { AppInput } from "./agent.js";

// A fetch stub that returns a live iTunes listing for the lookup, and an empty
// result set for the rank-check searches. Lets us assert that runAgent pulls the
// live listing's name + description into the proposed copy (issue #12) without a
// network or any baseCopy override.
function stubFetch(listing: { trackName?: string; description?: string; genres?: string[] }) {
  return async (url: string) => {
    const body = url.includes("/lookup")
      ? { resultCount: 1, results: [{ bundleId: "com.acme.app", ...listing }] }
      : { resultCount: 0, results: [] }; // search → no rank hits
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

const baseInput = (): AppInput => ({
  app: "Acme",
  bundleId: "com.acme.app",
  keywords: [{ keyword: "habit", volume: 60, difficulty: 40, relevance: 80 }],
  competitors: [],
  previousCompetitors: {},
  country: "US",
});

describe("runAgent — live listing seeds the proposal (issue #12)", () => {
  it("uses the live listing description when no baseCopy is provided", async () => {
    const fetchFn = stubFetch({
      trackName: "Acme — Habit Tracker",
      description: "Build better habits with gentle daily nudges.",
    });
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.proposedCopy.description).toBe("Build better habits with gentle daily nudges.");
  });

  it("uses the live track name as the proposed name when no baseCopy.name", async () => {
    const fetchFn = stubFetch({ trackName: "Acme — Habit Tracker", description: "x" });
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.proposedCopy.name).toContain("Acme");
  });

  it("still prefers an explicit baseCopy over the live listing", async () => {
    const fetchFn = stubFetch({ trackName: "Live Name", description: "live desc" });
    const input = { ...baseInput(), baseCopy: { name: "Override", description: "override desc" } };
    const r = await runAgent(fetchFn as never, input);
    expect(r.proposedCopy.name).toBe("Override");
    expect(r.proposedCopy.description).toBe("override desc");
  });

  it("omits description when the live listing has none and no override", async () => {
    const fetchFn = stubFetch({ trackName: "Acme" });
    const r = await runAgent(fetchFn as never, baseInput());
    // no description field at all (rather than an empty string) keeps the
    // fastlane bundle from emitting a blank description.txt
    expect(r.proposedCopy.description).toBeUndefined();
  });
});

// The run page renders a PR-style diff (current → proposed), so the result must
// carry the CURRENT copy it diffed against — the same floor the optimizer used.
describe("runAgent — currentCopy carries the 'before' for the diff", () => {
  it("reflects the live listing values when no baseCopy override", async () => {
    const fetchFn = stubFetch({ trackName: "Acme — Habit Tracker", description: "Live desc." });
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.currentCopy.name).toContain("Acme");
    expect(r.currentCopy.description).toBe("Live desc.");
  });

  it("reflects an explicit baseCopy (the live subtitle/keywords read from ASC)", async () => {
    const fetchFn = stubFetch({ trackName: "Live Name", description: "live desc" });
    const input = {
      ...baseInput(),
      ascMetadataRead: true,
      baseCopy: { name: "Heathen", subtitle: "Stoic calm for atheists", keywords: "mindfulness,stoic", description: "d" },
    };
    const r = await runAgent(fetchFn as never, input);
    expect(r.currentCopy.subtitle).toBe("Stoic calm for atheists");
    expect(r.currentCopy.keywords).toBe("mindfulness,stoic");
  });
});
