/**
 * The email deliverer: Notification → EmailMessage, and the Deliverer contract.
 * Pure over an injected EmailSender — no vendor, no network.
 */
import { describe, expect, it, vi } from "vitest";
import type { EmailMessage, EmailSender } from "../auth.js";
import { emailDeliverer, renderEmail } from "./emailDeliverer.js";
import type { Notification } from "./channel.js";

const NOTE: Notification = {
  kind: "run_ready",
  title: "Moonly — 4 proposals ready",
  body: "Autopilot drafted new copy and it's waiting at your approval gate.",
  url: "https://app.shipaso.com/runs/abc",
  lines: ["subtitle → Tarot, rituals & moon phases"],
};

function capturingSender(): { sender: EmailSender; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    sender: {
      channel: "test",
      async send(msg: EmailMessage) { sent.push(msg); },
      async sendMagicLink() {},
    },
  };
}

describe("renderEmail", () => {
  it("uses the title as the subject and carries body, lines and url", () => {
    const msg = renderEmail(NOTE, "a@example.com");
    expect(msg.to).toBe("a@example.com");
    expect(msg.subject).toBe(NOTE.title);
    expect(msg.text).toContain(NOTE.body);
    expect(msg.text).toContain("Tarot, rituals & moon phases");
    expect(msg.text).toContain(NOTE.url!);
    expect(msg.html).toContain(NOTE.url!);
  });

  it("adds List-Unsubscribe headers and a footer ONLY with an unsubscribe url", () => {
    const without = renderEmail(NOTE, "a@example.com");
    expect(without.headers).toBeUndefined();

    const with_ = renderEmail(NOTE, "a@example.com", { unsubscribeUrl: "https://api.test/u?t=1" });
    expect(with_.headers?.["List-Unsubscribe"]).toBe("<https://api.test/u?t=1>");
    expect(with_.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(with_.text).toContain("https://api.test/u?t=1");
  });

  it("escapes html so listing copy cannot inject markup", () => {
    const msg = renderEmail(
      { kind: "run_ready", title: "t", body: "<script>alert(1)</script>", lines: ["a & b"] },
      "a@example.com",
    );
    expect(msg.html).not.toContain("<script>");
    expect(msg.html).toContain("&lt;script&gt;");
    expect(msg.html).toContain("a &amp; b");
  });

  it("omits the list and link cleanly when absent (an SMS-shaped notification)", () => {
    const msg = renderEmail({ kind: "run_ready", title: "t", body: "b" }, "a@example.com");
    expect(msg.html).not.toContain("<ul>");
    expect(msg.text.trim()).toBe("b");
  });
});

describe("emailDeliverer", () => {
  it("sends and reports ok", async () => {
    const { sender, sent } = capturingSender();
    const res = await emailDeliverer(sender).deliver(
      { channel: "email", address: "a@example.com" },
      NOTE,
    );
    expect(res).toEqual({ ok: true, channel: "email", address: "a@example.com" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe(NOTE.title);
  });

  it("returns {ok:false} instead of THROWING when the transport fails", async () => {
    const sender: EmailSender = {
      channel: "boom",
      async send() { throw new Error("resend 500"); },
      async sendMagicLink() {},
    };
    const res = await emailDeliverer(sender).deliver(
      { channel: "email", address: "a@example.com" },
      NOTE,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/resend 500/);
  });

  it("threads a per-address unsubscribe url through to the message", async () => {
    const { sender, sent } = capturingSender();
    const mint = vi.fn(async (addr: string) => `https://api.test/u?a=${addr}`);
    await emailDeliverer(sender, mint).deliver(
      { channel: "email", address: "a@example.com" },
      NOTE,
    );
    expect(mint).toHaveBeenCalledWith("a@example.com");
    expect(sent[0]!.headers?.["List-Unsubscribe"]).toContain("a@example.com");
  });

  it("still sends when the unsubscribe mint fails — degrade, never drop", async () => {
    const { sender, sent } = capturingSender();
    const res = await emailDeliverer(sender, async () => undefined).deliver(
      { channel: "email", address: "a@example.com" },
      NOTE,
    );
    expect(res.ok).toBe(true);
    expect(sent[0]!.headers).toBeUndefined();
  });
});
