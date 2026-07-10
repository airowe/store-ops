/**
 * #67 Phase 2 — the autonomous KEYED sweep. When the owner stored an ASC key,
 * the sweep runs the full read-and-improve pass (keyedAscPass) instead of the
 * public audit, and the opened run notes it was read via the saved key. A
 * stored-key failure degrades to the public pass (never strands the sweep).
 * No stored key (or no KEK) → the public pass, unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THRESHOLDS } from "../thresholds.js";

const persistRun = vi.fn(async (_a: unknown): Promise<string> => "run-x");
const runAgent = vi.fn();
const keyedAscPass = vi.fn();
const useCredential = vi.fn();
const credentialsEnabled = vi.fn(() => true);
const mintAscJwt = vi.fn(async (_i: unknown) => "jwt-token");

const publicResult = {
  ranks: [{ keyword: "yoga", rank: null, error: "", total: 100, limit: 200, foundName: "" }], // crosses (unranked)
  competitors: { listings: [], changes: [], digest: "" },
};
const keyedResult = {
  ranks: [{ keyword: "yoga", rank: null, error: "", total: 100, limit: 200, foundName: "" }],
  competitors: { listings: [], changes: [], digest: "keyed" },
  findings: [{ id: "privacy_policy_missing", surface: "appInfo", severity: "critical", impact: "completeness", title: "x", detail: "y", fix: "z" }],
};

vi.mock("../d1.js", () => ({
  isAgentPaused: async () => false,
  getTier: async () => "indie",
  listAllApps: async () => [{ id: "app-1", user_id: "u1", bundle_id: "com.x.y", name: "X", country: "US" }],
  persistRun: (_db: unknown, a: unknown) => persistRun(a),
  getLatestCompetitorMap: async () => ({}),
  latestRunTraceForApp: async () => null,
  hasOpenRun: async () => false,
  getUser: async () => ({ email: "o@e.com" }),
  getRankHistory: async () => [],
  confirmedCompetitorKeys: async () => [],
  getThresholds: async () => ({ ...DEFAULT_THRESHOLDS }),
  getLatestRanks: async () => [],
  getSchedule: async () => ({ cadence: "weekly", day: 1, hourUtc: 9 }),
  getLastSweepAt: async () => null,
  setLastSweepAt: async () => undefined,
}));
vi.mock("../engine/index.js", () => ({ runAgent: (i: unknown) => runAgent(i) }));
vi.mock("../api/index.js", () => ({ keyedAscPass: (...a: unknown[]) => keyedAscPass(...a) }));
vi.mock("../engine/ascJwt.js", () => ({ mintAscJwt: (i: unknown) => mintAscJwt(i) }));
vi.mock("../credentialStore.js", () => ({
  credentialsEnabled: () => credentialsEnabled(),
  useCredential: (...a: unknown[]) => useCredential(...a),
}));
vi.mock("../api/runConfig.js", () => ({ buildAppInput: vi.fn(async () => ({})), descriptionFromTrace: () => undefined }));
vi.mock("../api/aiReasoner.js", () => ({ reasonerForEnv: () => null }));
vi.mock("../fetchAdapter.js", () => ({ fetchForEnv: () => fetch }));
vi.mock("../emailSender.js", () => ({ emailSenderForEnv: () => ({ send: async () => undefined }) }));
vi.mock("../push.js", () => ({ notifyRunAwaitingApproval: async () => undefined }));

import { runWeeklySweep } from "./scheduled.js";
const env = { DB: {}, AI: undefined } as never;

beforeEach(() => {
  vi.clearAllMocks();
  runAgent.mockResolvedValue(publicResult);
  keyedAscPass.mockResolvedValue({ result: keyedResult, resultWithSnapshot: { ...keyedResult, ascSnapshot: {} } });
  credentialsEnabled.mockReturnValue(true);
});

describe("autonomous keyed sweep (#67 Phase 2)", () => {
  it("a stored ASC key → the sweep runs keyedAscPass, not the public agent", async () => {
    useCredential.mockResolvedValue({ plaintext: "p8", meta: { keyId: "K", issuerId: "I" } });
    await runWeeklySweep(env, {});
    expect(keyedAscPass).toHaveBeenCalledTimes(1);
    expect(runAgent).not.toHaveBeenCalled();
    // the opened run carries the keyed result + notes the saved key
    const call = persistRun.mock.calls[0]![0] as { status: string; result: unknown; trigger: { reasons: string[] } };
    expect(call.status).toBe("awaiting_approval");
    expect(call.trigger.reasons.join(" ")).toContain("saved App Store Connect key");
  });

  it("no stored key → the public agent pass (unchanged behavior)", async () => {
    useCredential.mockResolvedValue(null);
    await runWeeklySweep(env, {});
    expect(keyedAscPass).not.toHaveBeenCalled();
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("no KEK configured → never even reads a stored credential", async () => {
    credentialsEnabled.mockReturnValue(false);
    await runWeeklySweep(env, {});
    expect(useCredential).not.toHaveBeenCalled();
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("a stored-key READ failure degrades to the public pass (never strands)", async () => {
    useCredential.mockResolvedValue({ plaintext: "p8", meta: { keyId: "K", issuerId: "I" } });
    keyedAscPass.mockRejectedValue(new Error("ASC 401"));
    const report = await runWeeklySweep(env, {});
    expect(runAgent).toHaveBeenCalledTimes(1); // fell back
    expect(report.appsProcessed).toBe(1);
    expect(report.perApp[0]!.error).toBeUndefined(); // the app was NOT errored out
  });
});
