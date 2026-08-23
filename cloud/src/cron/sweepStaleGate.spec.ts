/**
 * A gate nobody answered must not jam the machine.
 *
 * `hasOpenRun` had no age limit, so one unapproved run made `alreadyOpen`
 * permanently true for that app: no new gate, no push notification, forever.
 * The condition that clears it is a human approving, and the thing that tells
 * the human to approve is the notification the guard suppresses.
 *
 * Measured in production on 2026-08-23: all 14 apps sat in exactly this state,
 * 12 of them since 2026-08-03. Six weeks of Monday sweeps produced runs
 * carrying 3-4 proposals each, every one filed as 'detected' — no gate, no
 * notification. The one real paying user approved twice on day one, left a
 * third run open, and never heard from the product again.
 *
 * Every pre-existing sweep spec stubs `hasOpenRun` to false, so the true
 * branch had no coverage at all — which is how this shipped.
 *
 * The stacking that guard existed to prevent is already handled one layer
 * down: `persistRun` supersedes older open runs for the app whenever it writes
 * a new `awaiting_approval` (d1.ts, "Supersede:"). So a stale gate can be
 * replaced safely, and the user sees the CURRENT proposal instead of a
 * two-month-old one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const isAgentPaused = vi.fn(async (): Promise<boolean> => false);
const getTier = vi.fn(async (): Promise<string> => "indie");
const listAllApps = vi.fn(async (): Promise<Array<Record<string, string>>> => []);
const persistRun = vi.fn(async (): Promise<string> => "run-new");
const openRunAge = vi.fn(async (): Promise<number | null> => null);
const runAgent = vi.fn();
const notifyRunAwaitingApproval = vi.fn(async () => 1);

vi.mock("../d1.js", () => ({
  isAgentPaused: () => isAgentPaused(),
  getTier: () => getTier(),
  listAllApps: () => listAllApps(),
  persistRun: (_db: unknown, args: { status: string }) => {
    persistedStatuses.push(args.status);
    return persistRun();
  },
  getLatestCompetitorMap: async () => ({}),
  latestRunTraceForApp: async () => null,
  openRunAgeDays: () => openRunAge(),
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
vi.mock("../push.js", () => ({
  notifyRunAwaitingApproval: () => notifyRunAwaitingApproval(),
}));

const fetchMock = vi.fn(async (url: string) => {
  const bundleId = new URL(url).searchParams.get("bundleId") ?? "";
  return new Response(
    JSON.stringify({ resultCount: 1, results: [{ trackId: 1, trackName: "App", bundleId }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});
vi.mock("../fetchAdapter.js", () => ({ fetchForEnv: () => fetchMock }));

import { runWeeklySweep } from "./scheduled.js";

const env = { DB: {}, AI: undefined } as never;
let persistedStatuses: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  persistedStatuses = [];
  fetchMock.mockImplementation(async (url: string) => {
    const bundleId = new URL(url).searchParams.get("bundleId") ?? "";
    return new Response(
      JSON.stringify({ resultCount: 1, results: [{ trackId: 1, trackName: "App", bundleId }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  listAllApps.mockResolvedValue([
    { id: "a1", user_id: "u1", bundle_id: "com.x.app", name: "App", country: "US" },
  ]);
  // A targeted keyword is unranked → the threshold crosses on every sweep.
  runAgent.mockResolvedValue({
    ranks: [{ keyword: "yoga", rank: null, error: "", total: 100, limit: 200, foundName: "" }],
    competitors: { changes: [] },
    proposedCopy: {},
    currentCopy: {},
    pushCommands: [],
  });
});

describe("a stale approval gate does not silence the app", () => {
  it("opens a fresh gate when the existing one has gone stale", async () => {
    openRunAge.mockResolvedValue(60); // 60 days unanswered — production's real case

    await runWeeklySweep(env);

    expect(persistedStatuses).toContain("awaiting_approval");
    expect(notifyRunAwaitingApproval).toHaveBeenCalled();
  });

  it("still suppresses a second gate while the open one is fresh", async () => {
    openRunAge.mockResolvedValue(2); // answered-or-not, 2 days is not nagging-worthy

    await runWeeklySweep(env);

    expect(persistedStatuses).toEqual(["detected"]);
    expect(notifyRunAwaitingApproval).not.toHaveBeenCalled();
  });

  it("opens a gate normally when no run is open at all", async () => {
    openRunAge.mockResolvedValue(null);

    await runWeeklySweep(env);

    expect(persistedStatuses).toContain("awaiting_approval");
    expect(notifyRunAwaitingApproval).toHaveBeenCalled();
  });
});
