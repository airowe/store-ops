/**
 * Channel-neutral delivery fan-out. Pure over injected deliverers — no network,
 * no DB — so the isolation contract is exhaustively testable.
 *
 * The contract that matters: one channel failing must never cost another its
 * delivery. That is what makes it safe to add SMS/Telegram/Discord later without
 * putting the email path (the only one a judge will actually receive) at risk.
 */
import { describe, expect, it, vi } from "vitest";
import { deliverAll, type Deliverer, type Notification } from "./channel.js";

const NOTE: Notification = {
  kind: "run_ready",
  title: "Moonly — 4 proposals ready",
  body: "Autopilot drafted new copy and it's waiting at your approval gate.",
  url: "https://app.shipaso.com/runs/abc",
  lines: ["subtitle → Tarot, rituals & moon phases", "keywords → +moon, +ritual"],
};

const okDeliverer = (channel: "email" | "telegram") => ({
  channel,
  deliver: vi.fn(async (to: { address: string }) => ({
    ok: true as const,
    channel,
    address: to.address,
  })),
});

const failingDeliverer = (channel: "email" | "telegram", error = "transport down") => ({
  channel,
  deliver: vi.fn(async (to: { address: string }) => ({
    ok: false as const,
    channel,
    address: to.address,
    error,
  })),
});

describe("deliverAll", () => {
  it("delivers to each destination via its own channel's deliverer", async () => {
    const email = okDeliverer("email");
    const telegram = okDeliverer("telegram");
    const res = await deliverAll(
      NOTE,
      [
        { channel: "email", address: "a@example.com" },
        { channel: "telegram", address: "12345" },
      ],
      [email, telegram],
    );
    expect(res).toEqual([
      { ok: true, channel: "email", address: "a@example.com" },
      { ok: true, channel: "telegram", address: "12345" },
    ]);
    expect(email.deliver).toHaveBeenCalledOnce();
    expect(telegram.deliver).toHaveBeenCalledOnce();
  });

  it("ISOLATES failure — a dead telegram must not cost the email", async () => {
    const email = okDeliverer("email");
    const telegram = failingDeliverer("telegram");
    const res = await deliverAll(
      NOTE,
      [
        { channel: "telegram", address: "12345" },
        { channel: "email", address: "a@example.com" },
      ],
      [email, telegram],
    );
    expect(res[0]).toMatchObject({ ok: false, channel: "telegram" });
    expect(res[1]).toMatchObject({ ok: true, channel: "email" });
    expect(email.deliver).toHaveBeenCalledOnce();
  });

  it("NEVER throws when a deliverer throws — a notification cannot break its caller", async () => {
    const exploding: Deliverer = {
      channel: "telegram",
      deliver: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const email = okDeliverer("email");
    const res = await deliverAll(
      NOTE,
      [
        { channel: "telegram", address: "12345" },
        { channel: "email", address: "a@example.com" },
      ],
      [email, exploding],
    );
    expect(res[0]).toMatchObject({ ok: false, channel: "telegram" });
    if (!res[0]!.ok) expect(res[0]!.error).toMatch(/boom/);
    expect(res[1]).toMatchObject({ ok: true, channel: "email" });
  });

  it("REPORTS an unroutable destination rather than silently dropping it", async () => {
    const email = okDeliverer("email");
    const res = await deliverAll(NOTE, [{ channel: "telegram", address: "12345" }], [email]);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ ok: false, channel: "telegram" });
    if (!res[0]!.ok) expect(res[0]!.error).toMatch(/no deliverer|unsupported|not configured/i);
  });

  it("returns [] for no destinations, calling nothing", async () => {
    const email = okDeliverer("email");
    await expect(deliverAll(NOTE, [], [email])).resolves.toEqual([]);
    expect(email.deliver).not.toHaveBeenCalled();
  });

  it("preserves input order so a caller can attribute each result", async () => {
    const email = okDeliverer("email");
    const res = await deliverAll(
      NOTE,
      [
        { channel: "email", address: "first@example.com" },
        { channel: "email", address: "second@example.com" },
      ],
      [email],
    );
    expect(res.map((r) => r.address)).toEqual(["first@example.com", "second@example.com"]);
  });
});
