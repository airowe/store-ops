/**
 * The DAILY rank-snapshot path (issue #94). Unlike the weekly sweep, this is
 * snapshot-ONLY: for apps whose owner set rank_cadence='daily' (and isn't paused,
 * and is on a cron-autonomy tier) it runs ONLY the rank check and appends a dated
 * rank_snapshots row. It NEVER runs the full agent, NEVER opens an approval run,
 * and NEVER pushes — the autonomous draft cadence stays weekly/threshold-governed.
 *
 * `runDailySnapshot` calls the engine + d1 directly (not injected), so we mock
 * those modules — the same pattern as sweepPause.spec.ts. The assertions pin the
 * honesty guarantees: daily-cadence apps get a snapshot, weekly-cadence apps are
 * skipped, paused apps collect nothing, and NO run is ever persisted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rank } from "../engine/rankCheck.js";

const isAgentPaused = vi.fn(async (_db: unknown, _t: { userId: string; appId?: string }): Promise<boolean> => false);
const getTier = vi.fn(async (_db: unknown, _userId: string): Promise<string> => "autopilot");
const getRankCadence = vi.fn(async (_db: unknown, _userId: string): Promise<string> => "daily");
const listAllApps = vi.fn(async (): Promise<Array<Record<string, string>>> => []);
const getLatestCompetitorMap = vi.fn(async () => ({}));
const persistRankSnapshots = vi.fn(async (_db: unknown, _args: unknown): Promise<void> => undefined);
const persistRun = vi.fn(async (): Promise<string> => "run-x");
const buildAppInput = vi.fn(async () => ({ bundleId: "com.x", keywords: [{ keyword: "yoga" }], country: "US" }));
const aRank = (over: Partial<Rank> = {}): Rank => ({ keyword: "yoga", rank: 12, foundName: "X", total: 100, limit: 200, error: "", ...over });
const ranksFor = vi.fn(async (): Promise<Rank[]> => [aRank()]);

vi.mock("../d1.js", () => ({
  isAgentPaused: (db: unknown, t: { userId: string; appId?: string }) => isAgentPaused(db, t),
  getTier: (db: unknown, userId: string) => getTier(db, userId),
  getRankCadence: (db: unknown, userId: string) => getRankCadence(db, userId),
  listAllApps: () => listAllApps(),
  getLatestCompetitorMap: () => getLatestCompetitorMap(),
  persistRankSnapshots: (db: unknown, args: unknown) => persistRankSnapshots(db, args),
  persistRun: () => persistRun(),
}));
vi.mock("../engine/index.js", () => ({
  ranksFor: (...a: unknown[]) => ranksFor(...(a as [])),
}));
vi.mock("../api/runConfig.js", () => ({ buildAppInput: (...a: unknown[]) => buildAppInput(...(a as [])) }));
vi.mock("../api/aiReasoner.js", () => ({ reasonerForEnv: () => null }));
vi.mock("../fetchAdapter.js", () => ({ fetchForEnv: () => fetch }));

import { runDailySnapshot } from "./snapshot.js";
import type { Env } from "../index.js";

const env = { DB: {}, AI: undefined } as unknown as Env;

beforeEach(() => {
  vi.clearAllMocks();
  getTier.mockResolvedValue("autopilot");
  getRankCadence.mockResolvedValue("daily");
  isAgentPaused.mockResolvedValue(false);
  ranksFor.mockResolvedValue([aRank()]);
});
afterEach(() => vi.restoreAllMocks());

describe("runDailySnapshot — daily-cadence apps get a snapshot, no run", () => {
  it("rank-checks and persists a snapshot for a daily-cadence app", async () => {
    listAllApps.mockResolvedValue([{ id: "app-1", user_id: "user-1", bundle_id: "com.x" }]);

    const report = await runDailySnapshot(env);

    expect(ranksFor).toHaveBeenCalledTimes(1);
    expect(persistRankSnapshots).toHaveBeenCalledTimes(1);
    expect(persistRankSnapshots).toHaveBeenCalledWith(env.DB, expect.objectContaining({ appId: "app-1" }));
    expect(report.snapshotsTaken).toBe(1);
    // the autonomous draft cadence is UNTOUCHED: no run is ever opened.
    expect(persistRun).not.toHaveBeenCalled();
    const entry = report.perApp.find((e) => e.appId === "app-1")!;
    expect(entry.snapshotted).toBe(true);
  });

  it("persists the REAL ranks from the check (incl. honest null), never fabricated", async () => {
    listAllApps.mockResolvedValue([{ id: "app-1", user_id: "user-1", bundle_id: "com.x" }]);
    const realRanks: Rank[] = [
      aRank({ keyword: "yoga", rank: 12 }),
      aRank({ keyword: "breathwork", rank: null, foundName: "", total: 80 }),
    ];
    ranksFor.mockResolvedValue(realRanks);

    await runDailySnapshot(env);

    expect(persistRankSnapshots).toHaveBeenCalledWith(env.DB, expect.objectContaining({ ranks: realRanks }));
  });
});

describe("runDailySnapshot — skips weekly-cadence, paused, and ineligible tiers", () => {
  it("skips an app whose owner is on WEEKLY cadence (no snapshot, no run)", async () => {
    listAllApps.mockResolvedValue([{ id: "app-1", user_id: "user-1", bundle_id: "com.x" }]);
    getRankCadence.mockResolvedValue("weekly");

    const report = await runDailySnapshot(env);

    expect(ranksFor).not.toHaveBeenCalled();
    expect(persistRankSnapshots).not.toHaveBeenCalled();
    expect(report.snapshotsTaken).toBe(0);
    expect(report.skippedCadence).toBe(1);
  });

  it("skips a PAUSED daily app — collects nothing (honors the pause)", async () => {
    listAllApps.mockResolvedValue([{ id: "app-1", user_id: "user-1", bundle_id: "com.x" }]);
    isAgentPaused.mockResolvedValue(true);

    const report = await runDailySnapshot(env);

    expect(ranksFor).not.toHaveBeenCalled();
    expect(persistRankSnapshots).not.toHaveBeenCalled();
    expect(report.skippedPaused).toBe(1);
  });

  it("skips a free-tier app (no scheduled autonomy), never reading cadence", async () => {
    listAllApps.mockResolvedValue([{ id: "app-1", user_id: "user-1", bundle_id: "com.x" }]);
    getTier.mockResolvedValue("free");

    const report = await runDailySnapshot(env);

    expect(report.skippedTier).toBe(1);
    expect(getRankCadence).not.toHaveBeenCalled();
    expect(persistRankSnapshots).not.toHaveBeenCalled();
  });

  it("isolates a per-app failure: one bad app never aborts the batch", async () => {
    listAllApps.mockResolvedValue([
      { id: "app-bad", user_id: "user-1", bundle_id: "com.a" },
      { id: "app-good", user_id: "user-2", bundle_id: "com.b" },
    ]);
    ranksFor.mockImplementationOnce(async () => {
      throw new Error("itunes 503");
    });

    const report = await runDailySnapshot(env);

    // the good app still got its snapshot
    expect(persistRankSnapshots).toHaveBeenCalledTimes(1);
    const bad = report.perApp.find((e) => e.appId === "app-bad")!;
    expect(bad.error).toContain("itunes 503");
    expect(report.snapshotsTaken).toBe(1);
  });
});
