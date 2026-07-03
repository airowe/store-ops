/**
 * Digest preference gate (comms-prefs Phase 1): `email_digest='off'` silences
 * the weekly digest EMAIL for every app the user owns, while a 'weekly' user in
 * the SAME sweep still gets theirs — tested in both directions, because a gate
 * that silently never sends passes the "off works" test alone.
 *
 * Also pins: the user row is read ONCE per owner (cached), and 'off' skips
 * BEFORE the per-app hasOpenRun/getRankHistory reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const listAllApps = vi.fn(async (): Promise<Array<Record<string, string>>> => []);
const getUser = vi.fn(async (_db: unknown, _userId: string): Promise<unknown> => null);
const hasOpenRun = vi.fn(async () => false);
const getRankHistory = vi.fn(async () => [
  { keyword: "yoga", rank: 5, total: 100, checked_at: "2026-07-01 00:00:00" },
]);
const send = vi.fn(async (_msg: unknown) => undefined);

vi.mock("../d1.js", () => ({
  listAllApps: () => listAllApps(),
  getUser: (db: unknown, userId: string) => getUser(db, userId),
  hasOpenRun: () => hasOpenRun(),
  getRankHistory: () => getRankHistory(),
  // unused by sendWeeklyDigests but imported by scheduled.ts:
  isAgentPaused: vi.fn(),
  getTier: vi.fn(),
  persistRun: vi.fn(),
  getLatestCompetitorMap: vi.fn(),
  getPushRunReady: vi.fn(async () => true),
  listDeviceTokensForUser: vi.fn(async () => []),
  deleteDeviceToken: vi.fn(),
}));
vi.mock("../engine/index.js", () => ({ runAgent: vi.fn() }));
vi.mock("../api/runConfig.js", () => ({ buildAppInput: vi.fn(async () => ({})) }));
vi.mock("../api/aiReasoner.js", () => ({ reasonerForEnv: () => null }));
vi.mock("../fetchAdapter.js", () => ({ fetchForEnv: () => fetch }));
vi.mock("../emailSender.js", () => ({ emailSenderForEnv: () => ({ send: (msg: unknown) => send(msg) }) }));

import { sendWeeklyDigests, type CronReport } from "./scheduled.js";

const env = { DB: {}, AI: undefined } as never;

function entry(appId: string, bundleId: string): CronReport["perApp"][number] {
  return { appId, bundleId, crossed: false, runId: null, skippedOpenRun: false, reasons: [] };
}

function report(entries: CronReport["perApp"]): CronReport {
  return { appsProcessed: entries.length, runsOpened: 0, skippedTier: 0, skippedPaused: 0, perApp: entries };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendWeeklyDigests — email_digest gate (both directions)", () => {
  it("'off' user gets NO digest while a 'weekly' user in the same sweep still does", async () => {
    listAllApps.mockResolvedValue([
      { id: "app-off", user_id: "u-off", bundle_id: "com.off", name: "OffApp" },
      { id: "app-on", user_id: "u-on", bundle_id: "com.on", name: "OnApp" },
    ]);
    getUser.mockImplementation(async (_db, userId) =>
      userId === "u-off"
        ? { email: "off@example.com", tier: "indie", email_digest: "off", push_run_ready: true }
        : { email: "on@example.com", tier: "indie", email_digest: "weekly", push_run_ready: true },
    );

    const sent = await sendWeeklyDigests(env, report([entry("app-off", "com.off"), entry("app-on", "com.on")]));

    expect(sent).toBe(1); // delivered side: the 'weekly' user's digest still went
    const to = send.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(to).toEqual(["on@example.com"]); // suppressed side: never the 'off' user
  });

  it("a multi-app 'off' user contributes ZERO inputs and skips the per-app reads", async () => {
    listAllApps.mockResolvedValue([
      { id: "a1", user_id: "u-off", bundle_id: "com.a1", name: "A1" },
      { id: "a2", user_id: "u-off", bundle_id: "com.a2", name: "A2" },
      { id: "a3", user_id: "u-off", bundle_id: "com.a3", name: "A3" },
    ]);
    getUser.mockResolvedValue({ email: "off@example.com", tier: "scale", email_digest: "off", push_run_ready: true });

    const sent = await sendWeeklyDigests(env, report([entry("a1", "com.a1"), entry("a2", "com.a2"), entry("a3", "com.a3")]));

    expect(sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(hasOpenRun).not.toHaveBeenCalled(); // gated BEFORE the expensive reads
    expect(getRankHistory).not.toHaveBeenCalled();
    expect(getUser).toHaveBeenCalledTimes(1); // cached: one read for three apps
  });

  it("a NULL/legacy pref (mapUserRow default 'weekly') keeps today's behavior", async () => {
    listAllApps.mockResolvedValue([{ id: "a1", user_id: "u1", bundle_id: "com.a", name: "A" }]);
    // mapUserRow would coalesce a NULL column to 'weekly'; model that value here.
    getUser.mockResolvedValue({ email: "u@example.com", tier: "startup", email_digest: "weekly", push_run_ready: true });

    const sent = await sendWeeklyDigests(env, report([entry("a1", "com.a")]));
    expect(sent).toBe(1);
  });
});
