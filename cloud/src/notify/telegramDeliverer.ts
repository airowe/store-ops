/**
 * The Telegram `Deliverer` — a channel-neutral Notification rendered into a
 * Bot API sendMessage call.
 *
 * WHY TELEGRAM FIRST among the new channels: it is where the people we are
 * adding channels for already are. An operator whose agent runs through a
 * Telegram bot wants the "a run needs you" nudge in the same place, not in a
 * mailbox they check twice a day.
 *
 * TWO WAYS TELEGRAM FAILS THAT EMAIL DOES NOT, both handled as data:
 *   • A bot cannot open a conversation. If the user has never messaged it (or
 *     later blocks it) the API answers 403 "bot was blocked by the user" /
 *     "chat not found". That is a state the USER must fix, so we surface
 *     Telegram's own description verbatim rather than a generic "delivery
 *     failed" — the difference between an actionable message and a shrug.
 *   • The API answers in the BODY, not the status line: a refusal can arrive as
 *     HTTP 200 with `{ok: false}`. Checking `res.ok` alone would record a
 *     silent non-delivery as a success, which is the failure mode this codebase
 *     keeps hitting — a check that cannot return "no".
 *
 * Compliance stays channel-native: there is no unsubscribe footer here, because
 * Telegram unsubscribes by blocking the bot (which then surfaces as the 403
 * above). Exporting email's List-Unsubscribe conventions here would be applying
 * one channel's rules to another.
 */
import type { Deliverer, DeliveryResult, Destination, Notification } from "./channel.js";
import type { FetchFn } from "../engine/itunes.js";

/**
 * The longest text we will send.
 *
 * The Bot API rejects an over-long message rather than trimming it, and the
 * public docs pages do not state the bound in a form worth quoting, so this is
 * deliberately CONSERVATIVE: well inside any documented limit, and a truncated
 * nudge still does its whole job because the run link is what matters. The
 * alternative — send it and find out — turns a notification into a coin flip.
 */
export const TELEGRAM_TEXT_LIMIT = 3500;

/** Escape for parse_mode: "HTML". A crafted app name must not inject markup. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render a Notification as Telegram message text. Exported so the composition
 * is testable without a transport.
 *
 * Ordering is deliberate: title, body, what changed, then the link. A phone
 * notification shows the first line only, so the app name has to lead.
 */
export function renderTelegram(note: Notification): string {
  const parts = [`<b>${esc(note.title)}</b>`, esc(note.body)];
  const lines = note.lines ?? [];
  if (lines.length) parts.push(lines.map((l) => `• ${esc(l)}`).join("\n"));
  if (note.url) parts.push(esc(note.url));
  const text = parts.join("\n\n");
  // Truncate with an ellipsis so a clipped message reads as clipped rather than
  // as a sentence that simply stops.
  return text.length <= TELEGRAM_TEXT_LIMIT
    ? text
    : `${text.slice(0, TELEGRAM_TEXT_LIMIT - 1)}…`;
}

/** What the Bot API returns. `ok` is the authority, not the HTTP status. */
type BotResponse = { ok?: boolean; description?: string; error_code?: number };

/**
 * Build the Telegram deliverer over a bot token.
 *
 * Typed against the engine's narrow `FetchFn` rather than the global `fetch`,
 * matching every other outbound call in this codebase: it is the slice we
 * actually use (ok / status / text), it is what `fetchForEnv` returns, and it
 * is trivially stubbed in tests. `method`/`body` ride along on the init exactly
 * as `workerFetch` documents.
 */
export function telegramDeliverer(botToken: string, fetchImpl: FetchFn): Deliverer {
  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  return {
    channel: "telegram",
    async deliver(to: Destination, note: Notification): Promise<DeliveryResult> {
      const fail = (error: string): DeliveryResult => ({
        ok: false,
        channel: "telegram",
        address: to.address,
        error,
      });
      try {
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: to.address,
            text: renderTelegram(note),
            parse_mode: "HTML",
          }),
        } as Parameters<FetchFn>[1]);
        // A non-JSON body is a proxy or an outage, not an API answer. Reading it
        // as text first means a 502 HTML page is reported as a failure instead
        // of throwing a parse error out of a Deliverer contracted not to throw.
        const raw = await res.text();
        let parsed: BotResponse | null = null;
        try {
          parsed = raw ? (JSON.parse(raw) as BotResponse) : null;
        } catch {
          parsed = null;
        }
        if (!parsed) return fail(`HTTP ${res.status}: unreadable response from Telegram`);
        // `ok` is authoritative: a refusal can arrive as HTTP 200.
        if (parsed.ok !== true) {
          const code = parsed.error_code ?? res.status;
          return fail(parsed.description ?? `Telegram refused the message (${code})`);
        }
        return { ok: true, channel: "telegram", address: to.address };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  };
}
