/**
 * The channel choice: push when we can reach the device, email when we cannot.
 *
 * The gate is the SAME `push_run_ready` preference for both. A user who turned
 * run-ready notifications off means "do not tell me a run is ready", not "do
 * not tell me on this particular transport" — so the pref is read once, before
 * either channel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPushRunReady = vi.fn(async () => true);
const listDeviceTokensForUser = vi.fn(async (): Promise<string[]> => []);
const getUser = vi.fn(async (): Promise<{ email: string } | null> => ({ email: "owner@example.com" }));
const send = vi.fn(async (_msg: { to: string; subject: string }) => undefined);

vi.mock("./d1.js", () => ({
  getPushRunReady: () => getPushRunReady(),
  listDeviceTokensForUser: () => listDeviceTokensForUser(),
  deleteDeviceToken: async () => undefined,
  getUser: () => getUser(),
}));
vi.mock("./emailSender.js", () => ({ emailSenderForEnv: () => ({ channel: "test", send }) }));

import { notifyRunAwaitingApproval } from "./push.js";

const app = { user_id: "u1", name: "Mangia", bundle_id: "com.airowe.mangia" };
const env = { DASHBOARD_ORIGIN: "https://app.shipaso.com" } as never;
const pushFetch = vi.fn(async () =>
  new Response(JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 }),
);

beforeEach(() => {
  vi.clearAllMocks();
  getPushRunReady.mockResolvedValue(true);
  getUser.mockResolvedValue({ email: "owner@example.com" });
  send.mockResolvedValue(undefined);
  pushFetch.mockImplementation(async () =>
    new Response(JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 }),
  );
});

describe("run-ready notification picks a channel that can actually reach the user", () => {
  it("emails when the user has NO device token — the production case", async () => {
    listDeviceTokensForUser.mockResolvedValue([]);

    const n = await notifyRunAwaitingApproval(pushFetch, {} as never, app, "run-1", { env });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ to: "owner@example.com" });
    expect(n).toBe(1);
  });

  it("pushes and does NOT email when a device token exists", async () => {
    listDeviceTokensForUser.mockResolvedValue(["ExponentPushToken[abc]"]);

    await notifyRunAwaitingApproval(pushFetch, {} as never, app, "run-1", { env });

    expect(pushFetch).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends NOTHING on either channel when the owner turned run-ready off", async () => {
    getPushRunReady.mockResolvedValue(false);
    listDeviceTokensForUser.mockResolvedValue([]);

    const n = await notifyRunAwaitingApproval(pushFetch, {} as never, app, "run-1", { env });

    expect(send).not.toHaveBeenCalled();
    expect(pushFetch).not.toHaveBeenCalled();
    expect(n).toBe(0);
  });

  it("a failing email never aborts the run that triggered it", async () => {
    listDeviceTokensForUser.mockResolvedValue([]);
    send.mockRejectedValue(new Error("resend 500"));

    const n = await notifyRunAwaitingApproval(pushFetch, {} as never, app, "run-1", { env });

    expect(n).toBe(0); // reported honestly as "nobody reached", not thrown
  });

  it("no email address on the user row → no send, no throw", async () => {
    listDeviceTokensForUser.mockResolvedValue([]);
    getUser.mockResolvedValue(null);

    const n = await notifyRunAwaitingApproval(pushFetch, {} as never, app, "run-1", { env });

    expect(send).not.toHaveBeenCalled();
    expect(n).toBe(0);
  });
});
