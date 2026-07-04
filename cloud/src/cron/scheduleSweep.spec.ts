/**
 * #52 — the hourly cron sweeps ONLY due apps. Pins:
 *   • enforceSchedule + off-slot → skippedNotDue, agent NEVER runs, nothing
 *     persisted, no last-sweep stamp,
 *   • enforceSchedule + on-slot → sweeps and stamps last_sweep_at,
 *   • the min-gap makes a same-slot retry a no-op (idempotent hour),
 *   • without the flag (manual/admin invocation) every app sweeps as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCHEDULE } from "../schedule.js";

const persistRun = vi.fn(async (): Promise<string> => "run-x");
const runAgent = vi.fn();
const getSchedule = vi.fn(async () => ({ ...DEFAULT_SCHEDULE }));
const getLastSweepAt = vi.fn(async (): Promise<string | null> => null);
const setLastSweepAt = vi.fn(async () => undefined);

vi.mock("../d1.js", () => ({
  isAgentPaused: async () => false,
  getTier: async () => "indie",
  listAllApps: async () => [{ id: "app-1", user_id: "u1", bundle_id: "com.x.y", name: "X", country: "US" }],
  persistRun: () => persistRun(),
  getLatestCompetitorMap: async () => ({}),
  hasOpenRun: async () => false,
  getUser: async () => ({ email: "owner@example.com" }),
  getRankHistory: async () => [],
  confirmedCompetitorKeys: async () => [],
  getThresholds: async () => ({ unranked: true, competitorChanges: true, rankDropAtLeast: null, mutedKeywords: [], mutedCompetitors: [], notifyOnly: false }),
  getLatestRanks: async () => [],
  getSchedule: () => getSchedule(),
  getLastSweepAt: () => getLastSweepAt(),
  setLastSweepAt: () => setLastSweepAt(),
}));
vi.mock("../engine/index.js", () => ({ runAgent: (input: unknown) => runAgent(input) }));
vi.mock("../api/runConfig.js", () => ({ buildAppInput: vi.fn(async () => ({})) }));
vi.mock("../api/aiReasoner.js", () => ({ reasonerForEnv: () => null }));
vi.mock("../fetchAdapter.js", () => ({ fetchForEnv: () => fetch }));
vi.mock("../emailSender.js", () => ({ emailSenderForEnv: () => ({ send: async () => undefined }) }));
vi.mock("../push.js", () => ({ notifyRunAwaitingApproval: async () => undefined }));

import { runWeeklySweep } from "./scheduled.js";

const env = { DB: {}, AI: undefined } as never;
const MON_9 = new Date("2026-07-06T09:00:00Z"); // Monday 09:00 UTC — the default slot
const MON_10 = new Date("2026-07-06T10:00:00Z");

const quietResult = {
  ranks: [{ keyword: "yoga", rank: 3, error: "", total: 100, limit: 200, foundName: "X" }],
  competitors: { listings: [], changes: [], digest: "" },
};

beforeEach(() => {
  vi.clearAllMocks();
  runAgent.mockResolvedValue(quietResult);
  getSchedule.mockResolvedValue({ ...DEFAULT_SCHEDULE });
  getLastSweepAt.mockResolvedValue(null);
});

describe("runWeeklySweep — schedule gate (#52)", () => {
  it("off-slot hour → skippedNotDue; agent never runs, nothing persisted or stamped", async () => {
    const report = await runWeeklySweep(env, { enforceSchedule: true, now: MON_10 });
    expect(report.skippedNotDue).toBe(1);
    expect(report.appsProcessed).toBe(0);
    expect(runAgent).not.toHaveBeenCalled();
    expect(persistRun).not.toHaveBeenCalled();
    expect(setLastSweepAt).not.toHaveBeenCalled();
  });

  it("on-slot → sweeps and stamps last_sweep_at", async () => {
    const report = await runWeeklySweep(env, { enforceSchedule: true, now: MON_9 });
    expect(report.appsProcessed).toBe(1);
    expect(report.skippedNotDue).toBe(0);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(setLastSweepAt).toHaveBeenCalledTimes(1);
  });

  it("same-slot retry is a no-op (min-gap idempotency)", async () => {
    getLastSweepAt.mockResolvedValue("2026-07-06T09:00:00Z"); // just swept this slot
    const report = await runWeeklySweep(env, { enforceSchedule: true, now: MON_9 });
    expect(report.skippedNotDue).toBe(1);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("a custom daily schedule sweeps at ITS hour, not the default's", async () => {
    getSchedule.mockResolvedValue({ cadence: "daily", day: 1, hourUtc: 10 });
    const at10 = await runWeeklySweep(env, { enforceSchedule: true, now: MON_10 });
    expect(at10.appsProcessed).toBe(1);
    vi.clearAllMocks();
    runAgent.mockResolvedValue(quietResult);
    getSchedule.mockResolvedValue({ cadence: "daily", day: 1, hourUtc: 10 });
    getLastSweepAt.mockResolvedValue(null);
    const at9 = await runWeeklySweep(env, { enforceSchedule: true, now: MON_9 });
    expect(at9.skippedNotDue).toBe(1);
  });

  it("without enforceSchedule (manual/admin) every app sweeps regardless of slot", async () => {
    const report = await runWeeklySweep(env, { now: MON_10 });
    expect(report.appsProcessed).toBe(1);
    expect(getSchedule).not.toHaveBeenCalled(); // gate not even consulted
  });
});
