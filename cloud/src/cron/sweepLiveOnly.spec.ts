/**
 * The sweep must only track apps that are ACTUALLY IN THE STORE.
 *
 * Measured on the owner's own account: 13 connected apps, 7 live. The other
 * six had never shipped — four sitting in PREPARE_FOR_SUBMISSION, two REJECTED
 * at 1.0/0.1.0 with no prior version. So 46% of every sweep was spent checking
 * the organic rank of apps that cannot rank, because they are not there.
 *
 * That is worse than wasted work. An unshipped app and a live app nobody can
 * find produce the SAME empty rank result, so the product reported them
 * identically. "No rank measured" is honest for a live app; for an app that
 * was never published it is a category error dressed up as a measurement.
 *
 * The signal is the public listing itself: iTunes lookup by bundleId returns
 * resultCount 0 for an app that is not in the store. Verified against all 13
 * of the owner's apps — 13/13 agreed with their App Store Connect state, with
 * no credentials involved. That matters because the free tier has no key, so
 * a state-based check would not work there; this one works for everyone and
 * self-corrects when an app launches or is pulled.
 *
 * Checked, never stored: apps go live and get pulled, and a flag written at
 * connect time would be wrong the moment either happens.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const isAgentPaused = vi.fn(async (): Promise<boolean> => false);
const getTier = vi.fn(async (): Promise<string> => "indie");
const listAllApps = vi.fn(async (): Promise<Array<Record<string, string>>> => []);
const persistRun = vi.fn(async (): Promise<string> => "run-x");
const hasOpenRun = vi.fn(async () => false);
const runAgent = vi.fn();

vi.mock("../d1.js", () => ({
  isAgentPaused: () => isAgentPaused(),
  getTier: () => getTier(),
  listAllApps: () => listAllApps(),
  persistRun: () => persistRun(),
  getLatestCompetitorMap: async () => ({}),
  latestRunTraceForApp: async () => null,
  hasOpenRun: () => hasOpenRun(),
  getUser: async () => ({ email: "owner@example.com" }),
  getRankHistory: async () => [],
  confirmedCompetitorKeys: async () => [],
  getThresholds: async () => ({
    unranked: true,
    competitorChanges: true,
    rankDropAtLeast: null,
    mutedKeywords: [],
    mutedCompetitors: [],
    notifyOnly: false,
  }),
  getLatestRanks: async () => [],
}));
vi.mock("../engine/index.js", () => ({ runAgent: (input: unknown) => runAgent(input) }));
vi.mock("../api/runConfig.js", () => ({
  buildAppInput: vi.fn(async () => ({})),
  descriptionFromTrace: () => undefined,
}));
vi.mock("../api/aiReasoner.js", () => ({ reasonerForEnv: () => null }));
vi.mock("../emailSender.js", () => ({ emailSenderForEnv: () => ({ send: async () => undefined }) }));

/**
 * The liveness probe reaches the store over `fetchForEnv`. Driven by bundle id
 * so one batch can hold both a live and an unshipped app, which is the case
 * that matters: per-app isolation, not an all-or-nothing batch.
 */
const IN_STORE = new Set(["com.live.app"]);
const fetchMock = vi.fn(async (url: string) => {
  const bundleId = new URL(url).searchParams.get("bundleId") ?? "";
  const results = IN_STORE.has(bundleId)
    ? [{ trackId: 1, trackName: "Live App", bundleId }]
    : [];
  return new Response(JSON.stringify({ resultCount: results.length, results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
vi.mock("../fetchAdapter.js", () => ({ fetchForEnv: () => fetchMock }));

import { runWeeklySweep } from "./scheduled.js";

const env = { DB: {}, AI: undefined } as never;

const app = (id: string, bundle_id: string) => ({ id, user_id: "u1", bundle_id, name: id, country: "US" });

beforeEach(() => {
  // clearAllMocks() wipes call history AND implementations, so the store stub
  // must be reinstated or every lookup resolves undefined — which reads as a
  // thrown lookup and silently exercises the fail-open path instead of the
  // assertion under test. (Caught by mutation testing: flipping appIsLive to
  // fail CLOSED left this suite green until this line was added.)
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (url: string) => {
    const bundleId = new URL(url).searchParams.get("bundleId") ?? "";
    const results = IN_STORE.has(bundleId) ? [{ trackId: 1, trackName: "Live App", bundleId }] : [];
    return new Response(JSON.stringify({ resultCount: results.length, results }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  runAgent.mockResolvedValue({
    ranks: [{ keyword: "yoga", rank: null, error: "", total: 100, limit: 200, foundName: "" }],
    competitors: [],
    proposedCopy: {},
    currentCopy: {},
    pushCommands: [],
  });
});

describe("the sweep only tracks apps that are in the store", () => {
  it("skips an app that the store has never heard of", async () => {
    listAllApps.mockResolvedValue([app("a-ghost", "com.never.shipped")]);

    const report = await runWeeklySweep(env);

    expect(report.skippedNotLive).toBe(1);
    // The strong guarantee: nothing ran and nothing was written. A rank check
    // on an app that is not in the store has no result to report.
    expect(runAgent).not.toHaveBeenCalled();
    expect(persistRun).not.toHaveBeenCalled();
  });

  it("sweeps an app that IS in the store, unchanged", async () => {
    listAllApps.mockResolvedValue([app("a-live", "com.live.app")]);

    const report = await runWeeklySweep(env);

    expect(report.skippedNotLive).toBe(0);
    expect(report.appsProcessed).toBe(1);
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("isolates per app — one unshipped app does not stop the live one", async () => {
    listAllApps.mockResolvedValue([
      app("a-ghost", "com.never.shipped"),
      app("a-live", "com.live.app"),
    ]);

    const report = await runWeeklySweep(env);

    expect(report.skippedNotLive).toBe(1);
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("says WHY it skipped, so the reason is visible and not a silent drop", async () => {
    listAllApps.mockResolvedValue([app("a-ghost", "com.never.shipped")]);

    const report = await runWeeklySweep(env);

    const entry = report.perApp.find((p) => p.appId === "a-ghost");
    expect(entry?.skippedNotLive).toBe(true);
    expect(entry?.reasons.join(" ")).toMatch(/not in the store/i);
  });

  /**
   * Fail OPEN. A lookup that throws (iTunes down, network blip) must not be
   * read as "this app was deleted from the App Store" — that would silently
   * stop sweeping every app during an outage, and the user would see the
   * agent go quiet with no explanation.
   */
  it("sweeps anyway when the store lookup itself fails", async () => {
    listAllApps.mockResolvedValue([app("a-live", "com.live.app")]);
    // mockImplementation, not mockRejectedValueOnce: fetchJson RETRIES, so
    // failing a single attempt lets the retry succeed and never reaches the
    // catch. Every attempt must fail for this to test what it claims.
    fetchMock.mockImplementation(async () => {
      throw new Error("network down");
    });

    // Those retries sleep on real timers (~5s of backoff). Fake them so the
    // suite does not pay for production's retry policy.
    vi.useFakeTimers();
    const sweep = runWeeklySweep(env);
    await vi.runAllTimersAsync();
    const report = await sweep;
    vi.useRealTimers();

    expect(report.skippedNotLive).toBe(0);
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  /**
   * The probe runs AFTER the cheap local gates. A free-tier app must read as
   * skippedTier, not skippedNotLive — otherwise the report blames the store
   * for a billing decision, and we spend a network call to learn nothing.
   */
  it("lets the tier gate win, and costs no lookup when it does", async () => {
    getTier.mockResolvedValue("free");
    listAllApps.mockResolvedValue([app("a-ghost", "com.never.shipped")]);

    const report = await runWeeklySweep(env);

    expect(report.skippedTier).toBe(1);
    expect(report.skippedNotLive).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
