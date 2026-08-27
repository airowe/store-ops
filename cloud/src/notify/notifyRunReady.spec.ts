/**
 * The run_ready dispatch: gate → compose → fan out → record.
 *
 * Every dependency is injected, so the POLICY (who gets told, and when we stay
 * silent) is tested without a DB, a transport, or the network.
 *
 * The gating rules are the substance. Getting them wrong is not a cosmetic bug:
 * notifying on a status that is not the gate trains people to ignore the
 * channel, and notifying an opted-out user is a trust violation.
 */
import { describe, expect, it, vi } from "vitest";
import { notifyRunReady } from "./notifyRunReady.js";
import type { Destination } from "./channel.js";

const OK_DELIVERER = {
  channel: "email" as const,
  deliver: vi.fn(async (to: Destination) => ({
    ok: true as const,
    channel: "email" as const,
    address: to.address,
  })),
};

function deps(over: Partial<Parameters<typeof notifyRunReady>[0]> = {}) {
  return {
    userId: "u1",
    appName: "Moonly",
    runId: "run-1",
    status: "awaiting_approval" as string,
    changedFields: ["subtitle"],
    dashboardUrl: "https://app.shipaso.com",
    wantsRunReady: vi.fn(async () => true),
    destinationsFor: vi.fn(async (): Promise<Destination[]> => [
      { channel: "email", address: "a@example.com" },
    ]),
    deliverers: [OK_DELIVERER],
    record: vi.fn(async () => {}),
    ...over,
  };
}

describe("notifyRunReady — gating", () => {
  it("notifies when a run reaches the gate", async () => {
    const d = deps();
    const res = await notifyRunReady(d);
    expect(res.sent).toBe(1);
    expect(OK_DELIVERER.deliver).toHaveBeenCalled();
  });

  it("STAYS SILENT for any status that is not the gate", async () => {
    for (const status of ["detected", "researching", "approved", "rejected", "shipped", "superseded"]) {
      const d = deps({ status });
      const res = await notifyRunReady(d);
      expect(res.sent).toBe(0);
      expect(res.skipped).toBe("not-at-gate");
      expect(d.destinationsFor).not.toHaveBeenCalled();
    }
  });

  it("STAYS SILENT when the user opted out — before reading any destination", async () => {
    const d = deps({ wantsRunReady: vi.fn(async () => false) });
    const res = await notifyRunReady(d);
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe("opted-out");
    expect(d.destinationsFor).not.toHaveBeenCalled();
  });

  it("is a clean no-op when the user has no deliverable destination", async () => {
    const d = deps({ destinationsFor: vi.fn(async () => []) });
    const res = await notifyRunReady(d);
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe("no-destinations");
  });
});

describe("notifyRunReady — resilience", () => {
  it("NEVER throws when a deliverer fails — a run must not fail on a notification", async () => {
    const boom = {
      channel: "email" as const,
      deliver: vi.fn(async () => {
        throw new Error("resend down");
      }),
    };
    const res = await notifyRunReady(deps({ deliverers: [boom] }));
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(1);
  });

  it("NEVER throws when the preference lookup itself fails", async () => {
    const d = deps({
      wantsRunReady: vi.fn(async () => {
        throw new Error("d1 unavailable");
      }),
    });
    await expect(notifyRunReady(d)).resolves.toMatchObject({ sent: 0, skipped: "error" });
  });

  it("records each attempt so a dead destination becomes visible", async () => {
    const d = deps();
    await notifyRunReady(d);
    expect(d.record).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "email", address: "a@example.com" }),
    );
  });

  it("still reports success on the channels that worked when another failed", async () => {
    const good = {
      channel: "email" as const,
      deliver: vi.fn(async (to: Destination) => ({ ok: true as const, channel: "email" as const, address: to.address })),
    };
    const bad = {
      channel: "telegram" as const,
      deliver: vi.fn(async (to: Destination) => ({
        ok: false as const, channel: "telegram" as const, address: to.address, error: "chat not found",
      })),
    };
    const res = await notifyRunReady(
      deps({
        destinationsFor: async () => [
          { channel: "telegram", address: "123" },
          { channel: "email", address: "a@example.com" },
        ],
        deliverers: [good, bad],
      }),
    );
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(1);
  });
});
