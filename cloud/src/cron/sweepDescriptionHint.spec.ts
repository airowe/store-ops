/**
 * The cron PUBLIC pass builds the agent input BEFORE the agent reads the live
 * listing — so without help the keyword reasoner has no description and falls
 * back to tokenizing the name ("Who Got Cooked" → "who"/"got"/"cooked"). The
 * sweep must thread the PRIOR run's stored live description into buildAppInput
 * as `descriptionHint` (reasoning-only, never baseCopy) so the reasoner runs.
 *
 * Same mock harness as scheduleSweep.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const persistRun = vi.fn(async (): Promise<string> => "run-x");
const runAgent = vi.fn();
const latestRunTraceForApp = vi.fn(async (): Promise<unknown> => null);
const buildAppInput = vi.fn(async (..._args: unknown[]) => ({}));

vi.mock("../d1.js", () => ({
  isAgentPaused: async () => false,
  getTier: async () => "indie",
  listAllApps: async () => [{ id: "app-1", user_id: "u1", bundle_id: "com.x.y", name: "Who Got Cooked", country: "US" }],
  persistRun: () => persistRun(),
  getLatestCompetitorMap: async () => ({}),
  hasOpenRun: async () => false,
  getUser: async () => ({ email: "owner@example.com" }),
  getRankHistory: async () => [],
  confirmedCompetitorKeys: async () => [],
  getThresholds: async () => ({ unranked: true, competitorChanges: true, rankDropAtLeast: null, mutedKeywords: [], mutedCompetitors: [], notifyOnly: false }),
  getLatestRanks: async () => [],
  getSchedule: async () => ({ cadence: "weekly", day: 1, hourUtc: 9 }),
  getLastSweepAt: async () => null,
  setLastSweepAt: async () => undefined,
  latestRunTraceForApp: () => latestRunTraceForApp(),
}));
vi.mock("../engine/index.js", () => ({ runAgent: (input: unknown) => runAgent(input) }));
// buildAppInput is captured; descriptionFromTrace stays REAL — the extraction
// (audit.liveDescription → currentCopy.description → undefined) is under test.
vi.mock("../api/runConfig.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/runConfig.js")>()),
  buildAppInput: (...a: unknown[]) => buildAppInput(...a),
}));
vi.mock("../api/aiReasoner.js", () => ({ reasonerForEnv: () => null }));
vi.mock("../fetchAdapter.js", () => ({ fetchForEnv: () => fetch }));
vi.mock("../emailSender.js", () => ({ emailSenderForEnv: () => ({ send: async () => undefined }) }));
vi.mock("../push.js", () => ({ notifyRunAwaitingApproval: async () => undefined }));

import { runWeeklySweep } from "./scheduled.js";

const env = { DB: {}, AI: undefined } as never;

const quietResult = {
  ranks: [{ keyword: "yoga", rank: 3, error: "", total: 100, limit: 200, foundName: "X" }],
  competitors: { listings: [], changes: [], digest: "" },
};

const DESC =
  "Send the screenshot. Get the verdict. Who Got Cooked is the courtroom for your group chat.";

beforeEach(() => {
  vi.clearAllMocks();
  runAgent.mockResolvedValue(quietResult);
  latestRunTraceForApp.mockResolvedValue(null);
});

describe("runWeeklySweep — public pass threads the prior run's description into keyword reasoning", () => {
  it("passes the stored live description as descriptionHint when a prior trace has one", async () => {
    latestRunTraceForApp.mockResolvedValue({
      runId: "run-prev",
      createdAt: "2026-07-04 05:25:00",
      trace: { audit: { liveDescription: DESC }, currentCopy: {} },
    });
    await runWeeklySweep(env, {});
    expect(buildAppInput).toHaveBeenCalledTimes(1);
    const overrides = buildAppInput.mock.calls[0]?.[1] as { descriptionHint?: string };
    expect(overrides.descriptionHint).toBe(DESC);
  });

  it("falls back to the trace's currentCopy description when the audit carries none", async () => {
    latestRunTraceForApp.mockResolvedValue({
      runId: "run-prev",
      createdAt: "2026-07-04 05:25:00",
      trace: { audit: {}, currentCopy: { description: DESC } },
    });
    await runWeeklySweep(env, {});
    const overrides = buildAppInput.mock.calls[0]?.[1] as { descriptionHint?: string };
    expect(overrides.descriptionHint).toBe(DESC);
  });

  it("omits the hint when the app has no prior run (first sweep stays name-seeded)", async () => {
    await runWeeklySweep(env, {});
    const overrides = buildAppInput.mock.calls[0]?.[1] as { descriptionHint?: string };
    expect(overrides.descriptionHint).toBeUndefined();
  });
});
