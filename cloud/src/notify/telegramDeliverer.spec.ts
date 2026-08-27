/**
 * The Telegram `Deliverer`.
 *
 * Telegram is the channel the challenge's audience actually lives in — a lot of
 * people already run their agent through a bot there. The contract is the same
 * as email's: render the neutral Notification natively, and NEVER throw, so one
 * dead webhook cannot cost someone their email.
 *
 * The failure cases carry most of the weight here, because Telegram fails in a
 * way email does not: a bot cannot message a user who has never messaged it,
 * and that is a 403 the user must fix, not a transient error to retry forever.
 */
import { describe, expect, it, vi } from "vitest";
import { renderTelegram, telegramDeliverer, TELEGRAM_TEXT_LIMIT } from "./telegramDeliverer.js";
import type { Notification } from "./channel.js";

const NOTE: Notification = {
  kind: "run_ready",
  title: "Ballpark — a proposal is waiting",
  body: "Autopilot prepared new copy and it needs your decision.",
  lines: ["subtitle: Track every game → Every game, every score"],
  url: "https://shipaso.com/runs/r_1",
};

/** A FetchFn-shaped fake — ok / status / text, the slice the deliverer uses. */
function fakeFetch(status: number, body: string) {
  return vi.fn(async (_url: string, _init?: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
  }));
}
const okFetch = () => fakeFetch(200, JSON.stringify({ ok: true, result: { message_id: 1 } }));

describe("renderTelegram", () => {
  it("leads with the title and includes the body", () => {
    const text = renderTelegram(NOTE);
    expect(text).toContain("Ballpark");
    expect(text).toContain("needs your decision");
  });

  it("renders the structured lines as a list", () => {
    expect(renderTelegram(NOTE)).toContain("• subtitle: Track every game → Every game, every score");
  });

  it("places the url natively rather than inlining it in the body", () => {
    expect(renderTelegram(NOTE)).toContain("https://shipaso.com/runs/r_1");
  });

  it("omits the list entirely when there are no lines", () => {
    const text = renderTelegram({ ...NOTE, lines: [] });
    expect(text).not.toContain("•");
  });

  it("escapes HTML so a crafted app name cannot inject markup", () => {
    const text = renderTelegram({ ...NOTE, title: "<b>bold</b> & co" });
    expect(text).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; co");
    expect(text).not.toContain("<b>bold</b>");
  });

  it("truncates rather than letting Telegram reject an over-long message", () => {
    const text = renderTelegram({ ...NOTE, body: "x".repeat(TELEGRAM_TEXT_LIMIT * 2) });
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(text).toMatch(/…$/);
  });

  it("keeps a normal message intact — truncation is not applied to everything", () => {
    expect(renderTelegram(NOTE)).not.toMatch(/…$/);
  });
});

describe("telegramDeliverer", () => {
  it("POSTs to the bot's sendMessage endpoint with the chat id", async () => {
    const fetchImpl = okFetch();
    const d = telegramDeliverer("BOT:TOKEN", fetchImpl);
    const result = await d.deliver({ channel: "telegram", address: "12345" }, NOTE);
    expect(result.ok).toBe(true);
    const call = fetchImpl.mock.calls[0]!;
    expect(String(call[0])).toBe("https://api.telegram.org/botBOT:TOKEN/sendMessage");
    const body = JSON.parse(String((call[1] as { body?: unknown }).body));
    expect(body.chat_id).toBe("12345");
    expect(body.text).toContain("Ballpark");
  });

  it("declares the channel it serves", () => {
    expect(telegramDeliverer("t", okFetch()).channel).toBe("telegram");
  });

  it("reports Telegram's own description when the API refuses", async () => {
    const fetchImpl = fakeFetch(
      403,
      JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }),
    );
    const d = telegramDeliverer("t", fetchImpl);
    const result = await d.deliver({ channel: "telegram", address: "1" }, NOTE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("blocked by the user");
  });

  it("treats ok:false as a failure even on HTTP 200 — the API answers in the body", async () => {
    const fetchImpl = fakeFetch(
      200,
      JSON.stringify({ ok: false, error_code: 400, description: "chat not found" }),
    );
    const d = telegramDeliverer("t", fetchImpl);
    const result = await d.deliver({ channel: "telegram", address: "nope" }, NOTE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("chat not found");
  });

  it("NEVER throws when the network fails — a failure is data", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as Parameters<typeof telegramDeliverer>[1];
    const d = telegramDeliverer("t", fetchImpl);
    const result = await d.deliver({ channel: "telegram", address: "1" }, NOTE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("ECONNREFUSED");
  });

  it("NEVER throws when the response is not JSON at all", async () => {
    const fetchImpl = fakeFetch(502, "<html>502 Bad Gateway</html>");
    const d = telegramDeliverer("t", fetchImpl);
    const result = await d.deliver({ channel: "telegram", address: "1" }, NOTE);
    expect(result.ok).toBe(false);
  });

  it("carries the address through to the result so a caller can log precisely", async () => {
    const d = telegramDeliverer("t", okFetch());
    const result = await d.deliver({ channel: "telegram", address: "chat_9" }, NOTE);
    expect(result.address).toBe("chat_9");
    expect(result.channel).toBe("telegram");
  });
});
