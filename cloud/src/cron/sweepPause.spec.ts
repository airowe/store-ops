/**
 * The weekly sweep must HONOR an explicit pause (issue #51). A paused target is
 * skipped right after the tier gate — BEFORE the agent runs — so it opens no run
 * (no awaiting_approval, no `detected` snapshot) and never reaches the digest.
 *
 * `runWeeklySweep` calls the engine + d1 directly (not injected), so we mock
 * those modules. The pause check sits before `runAgent`/`persistRun`, which lets
 * us assert the strong honesty guarantee: for a paused app, the agent never runs
 * and NOTHING is persisted; an un-paused app in the SAME batch still sweeps
 * normally (per-target isolation). We also pin tier-gate precedence (a free user
 * is skippedTier, never skippedPaused) and that the digest skips paused entries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── module mocks (declared before importing the unit under test) ──────────────
const isAgentPaused = vi.fn(async (_db: unknown, _t: { userId: string; appId?: string }): Promise<boolean> => false);
const getTier = vi.fn(async (_db: unknown, _userId: string): Promise<string> => "indie");
const listAllApps = vi.fn(async (): Promise<Array<Record<string, string>>> => []);
const persistRun = vi.fn(async (): Promise<string> => "run-x");
const getLatestCompetitorMap = vi.fn(async () => ({}));
const hasOpenRun = vi.fn(async () => false);
const getUser = vi.fn(async () => ({ email: "owner@example.com" }));
const getRankHistory = vi.fn(async () => []);
const runAgent = vi.fn();
const send = vi.fn(async (_msg: unknown) => undefined);

vi.mock("../d1.js", () => ({
  isAgentPaused: (db: unknown, t: { userId: string; appId?: string }) => isAgentPaused(db, t),
  getTier: (db: unknown, userId: string) => getTier(db, userId),
  listAllApps: () => listAllApps(),
  persistRun: () => persistRun(),
  getLatestCompetitorMap: () => getLatestCompetitorMap(),
  hasOpenRun: () => hasOpenRun(),
  getUser: () => getUser(),
  getRankHistory: () => getRankHistory(),
  confirmedCompetitorKeys: async () => [], // #72: sweep watches confirmed rows
  // #53: fail-open defaults — the historical trigger behavior
  getThresholds: async () => ({ unranked: true, competitorChanges: true, rankDropAtLeast: null, mutedKeywords: [], mutedCompetitors: [], notifyOnly: false }),
  getLatestRanks: async () => [],
}));
vi.mock("../engine/index.js", () => ({ runAgent: (input: unknown) => runAgent(input) }));
vi.mock("../api/runConfig.js", () => ({ buildAppInput: vi.fn(async () => ({})) }));
vi.mock("../api/aiReasoner.js", () => ({ reasonerForEnv: () => null }));
vi.mock("../fetchAdapter.js", () => ({ fetchForEnv: () => fetch }));
vi.mock("../emailSender.js", () => ({ emailSenderForEnv: () => ({ send: (msg: unknown) => send(msg) }) }));

import { runWeeklySweep, sendWeeklyDigests } from "./scheduled.js";

const env = { DB: {}, AI: undefined } as never;

// A result that WOULD cross the threshold (an unranked targeted keyword), to prove
// the paused skip beats the would-open path.
const crossingResult = {
  ranks: [{ keyword: "yoga", rank: null, error: "", total: 100, limit: 200, foundName: "" }],
  competitors: { listings: [], changes: [], digest: "" },
};

beforeEach(() => {
  vi.clearAllMocks();
  getTier.mockResolvedValue("indie");
  isAgentPaused.mockResolvedValue(false);
  persistRun.mockResolvedValue("run-x");
  runAgent.mockResolvedValue(crossingResult);
});
afterEach(() => vi.restoreAllMocks());

describe("runWeeklySweep — honors pause", () => {
  it("skips a paused app: no agent run, no persisted run, flagged skippedPaused", async () => {
    listAllApps.mockResolvedValue([{ id: "app-1", user_id: "user-1", bundle_id: "com.x" }]);
    isAgentPaused.mockResolvedValue(true);

    const report = await runWeeklySweep(env);

    expect(report.runsOpened).toBe(0);
    expect(report.skippedPaused).toBe(1);
    // honesty: a paused target collects NO data — the agent never runs and nothing
    // is written (not even a `detected` snapshot).
    expect(runAgent).not.toHaveBeenCalled();
    expect(persistRun).not.toHaveBeenCalled();
    const entry = report.perApp.find((e) => e.appId === "app-1")!;
    expect(entry.skippedPaused).toBe(true);
    expect(entry.runId).toBeNull();
    expect(entry.reasons.join(" ")).toMatch(/paused/i);
  });

  it("still sweeps an un-paused app in the same batch (per-target isolation)", async () => {
    listAllApps.mockResolvedValue([
      { id: "app-paused", user_id: "user-1", bundle_id: "com.a" },
      { id: "app-live", user_id: "user-2", bundle_id: "com.b" },
    ]);
    isAgentPaused.mockImplementation(async (_db, t) => t.userId === "user-1");

    const report = await runWeeklySweep(env);

    expect(report.skippedPaused).toBe(1);
    // the live app actually ran the agent + opened a run
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(report.runsOpened).toBe(1);
    const live = report.perApp.find((e) => e.appId === "app-live")!;
    expect(live.skippedPaused).toBeFalsy();
    expect(live.runId).toBe("run-x");
  });

  it("tier gate wins: a free un-paused user is skippedTier, not skippedPaused", async () => {
    listAllApps.mockResolvedValue([{ id: "app-1", user_id: "user-1", bundle_id: "com.x" }]);
    getTier.mockResolvedValue("free");
    isAgentPaused.mockResolvedValue(false);

    const report = await runWeeklySweep(env);

    expect(report.skippedTier).toBe(1);
    expect(report.skippedPaused).toBe(0);
    // tier is checked first — a free user's pause flag is never even read.
    expect(isAgentPaused).not.toHaveBeenCalled();
    const entry = report.perApp.find((e) => e.appId === "app-1")!;
    expect(entry.skippedTier).toBe(true);
    expect(entry.skippedPaused).toBeFalsy();
  });
});

describe("sendWeeklyDigests — suppresses paused targets", () => {
  it("sends no digest for a skippedPaused entry", async () => {
    listAllApps.mockResolvedValue([{ id: "app-1", user_id: "user-1", bundle_id: "com.x", name: "X" }]);
    const report = {
      appsProcessed: 1,
      runsOpened: 0,
      skippedTier: 0,
      skippedPaused: 1,
      perApp: [
        {
          appId: "app-1",
          bundleId: "com.x",
          crossed: false,
          runId: null,
          skippedOpenRun: false,
          skippedPaused: true,
          reasons: ["skipped — agent paused by owner"],
        },
      ],
    };

    const sent = await sendWeeklyDigests(env, report);
    expect(sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
