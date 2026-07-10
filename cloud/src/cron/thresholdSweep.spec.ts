/**
 * #53 — the sweep honors per-app threshold config. Pins:
 *   • notifyOnly: a crossing is RECORDED (status 'detected', reason says so)
 *     but no awaiting_approval run opens and no push fires,
 *   • a muted/disabled config quietly records a snapshot ("no threshold crossed"),
 *   • the drop trigger reads last week's ranks ONLY when configured (no wasted read).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from "../thresholds.js";

const persistRun = vi.fn(async (_args: unknown): Promise<string> => "run-x");
const getThresholds = vi.fn(async (): Promise<ThresholdConfig> => ({ ...DEFAULT_THRESHOLDS }));
const getLatestRanks = vi.fn(async (): Promise<Array<{ keyword: string; rank: number | null }>> => []);
const notifyRunAwaitingApproval = vi.fn(async () => undefined);
const runAgent = vi.fn();

vi.mock("../d1.js", () => ({
  isAgentPaused: async () => false,
  getTier: async () => "indie",
  listAllApps: async () => [{ id: "app-1", user_id: "u1", bundle_id: "com.x.y", name: "X", country: "US" }],
  persistRun: (_db: unknown, args: unknown) => persistRun(args),
  getLatestCompetitorMap: async () => ({}),
  latestRunTraceForApp: async () => null,
  hasOpenRun: async () => false,
  getUser: async () => ({ email: "owner@example.com" }),
  getRankHistory: async () => [],
  confirmedCompetitorKeys: async () => [],
  getThresholds: () => getThresholds(),
  getLatestRanks: () => getLatestRanks(),
}));
vi.mock("../engine/index.js", () => ({ runAgent: (input: unknown) => runAgent(input) }));
vi.mock("../api/runConfig.js", () => ({ buildAppInput: vi.fn(async () => ({})), descriptionFromTrace: () => undefined }));
vi.mock("../api/aiReasoner.js", () => ({ reasonerForEnv: () => null }));
vi.mock("../fetchAdapter.js", () => ({ fetchForEnv: () => fetch }));
vi.mock("../emailSender.js", () => ({ emailSenderForEnv: () => ({ send: async () => undefined }) }));
vi.mock("../push.js", () => ({ notifyRunAwaitingApproval: () => notifyRunAwaitingApproval() }));

import { runWeeklySweep } from "./scheduled.js";

const env = { DB: {}, AI: undefined } as never;

const crossingResult = {
  ranks: [{ keyword: "yoga", rank: null, error: "", total: 100, limit: 200, foundName: "" }],
  competitors: { listings: [], changes: [], digest: "" },
};

beforeEach(() => {
  vi.clearAllMocks();
  runAgent.mockResolvedValue(crossingResult);
  getThresholds.mockResolvedValue({ ...DEFAULT_THRESHOLDS });
});

describe("runWeeklySweep honors threshold config (#53)", () => {
  it("default config: a crossing opens an awaiting_approval run + push (baseline)", async () => {
    const report = await runWeeklySweep(env);
    expect(report.runsOpened).toBe(1);
    expect(persistRun).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_approval" }));
    expect(notifyRunAwaitingApproval).toHaveBeenCalledTimes(1);
  });

  it("notifyOnly: crossing recorded as 'detected' with the reason, NO run, NO push", async () => {
    getThresholds.mockResolvedValue({ ...DEFAULT_THRESHOLDS, notifyOnly: true });
    const report = await runWeeklySweep(env);
    expect(report.runsOpened).toBe(0);
    expect(notifyRunAwaitingApproval).not.toHaveBeenCalled();
    const call = persistRun.mock.calls[0]![0] as { status: string; trigger: { reasons: string[] } };
    expect(call.status).toBe("detected");
    expect(call.trigger.reasons.join(" ")).toContain("notify-only");
    // the crossing itself is still visible in the report (measured, not hidden)
    expect(report.perApp[0]!.crossed).toBe(true);
  });

  it("disabled unranked trigger: quiet snapshot, no nag", async () => {
    getThresholds.mockResolvedValue({ ...DEFAULT_THRESHOLDS, unranked: false });
    const report = await runWeeklySweep(env);
    expect(report.runsOpened).toBe(0);
    const call = persistRun.mock.calls[0]![0] as { status: string; trigger: { reasons: string[] } };
    expect(call.trigger.reasons.join(" ")).toContain("no threshold crossed");
  });

  it("previous ranks are read ONLY when the drop trigger is configured", async () => {
    await runWeeklySweep(env);
    expect(getLatestRanks).not.toHaveBeenCalled(); // default: drop trigger off
    getThresholds.mockResolvedValue({ ...DEFAULT_THRESHOLDS, rankDropAtLeast: 10 });
    await runWeeklySweep(env);
    expect(getLatestRanks).toHaveBeenCalledTimes(1);
  });
});
