/**
 * The email `Deliverer` — a channel-neutral Notification rendered into the
 * EmailMessage the existing `EmailSender` already takes.
 *
 * This is a thin adapter ON TOP of the current transport, not a replacement:
 * Resend selection, the console fallback, and the List-Unsubscribe headers all
 * keep working exactly as they do for the weekly digest. What changes is only
 * that the composer no longer knows it is writing an email.
 *
 * COMPLIANCE STAYS EMAIL-SPECIFIC and stays here. `unsubscribeUrl` produces the
 * footer and the List-Unsubscribe / List-Unsubscribe-Post headers, because those
 * are email conventions — Telegram unsubscribes by blocking the bot. Pushing
 * them into the neutral Notification would export one channel's rules to all of
 * them.
 */
import type { EmailMessage, EmailSender } from "../auth.js";
import type { Deliverer, DeliveryResult, Destination, Notification } from "./channel.js";

/** Escape text interpolated into the HTML body. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a Notification as an email. Exported for testing the composition
 * independently of any transport.
 */
export function renderEmail(
  note: Notification,
  to: string,
  opts?: { unsubscribeUrl?: string },
): EmailMessage {
  const lines = note.lines ?? [];
  const textParts = [note.body];
  if (lines.length) textParts.push("", ...lines.map((l) => `• ${l}`));
  if (note.url) textParts.push("", note.url);
  if (opts?.unsubscribeUrl) {
    textParts.push("", `Stop these emails: ${opts.unsubscribeUrl}`);
  }

  const htmlParts = [`<p>${esc(note.body)}</p>`];
  if (lines.length) {
    htmlParts.push(`<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);
  }
  if (note.url) {
    htmlParts.push(`<p><a href="${esc(note.url)}">${esc(note.url)}</a></p>`);
  }
  if (opts?.unsubscribeUrl) {
    htmlParts.push(
      `<p style="color:#888;font-size:12px">` +
        `<a href="${esc(opts.unsubscribeUrl)}">Stop these emails</a></p>`,
    );
  }

  return {
    to,
    subject: note.title,
    text: textParts.join("\n"),
    html: htmlParts.join("\n"),
    ...(opts?.unsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${opts.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  };
}

/**
 * Build the email deliverer over an existing EmailSender.
 *
 * `unsubscribeUrlFor` is injected rather than computed here: minting a token
 * needs a secret and an origin the cron resolves once per run, and the digest
 * already caches one token per unique address. Returning undefined degrades to
 * an email with no footer — the digest's existing behavior when API_ORIGIN is
 * unset — rather than dropping the message.
 */
export function emailDeliverer(
  sender: EmailSender,
  unsubscribeUrlFor?: (address: string) => Promise<string | undefined>,
): Deliverer {
  return {
    channel: "email",
    async deliver(to: Destination, note: Notification): Promise<DeliveryResult> {
      try {
        const unsubscribeUrl = await unsubscribeUrlFor?.(to.address);
        await sender.send(
          renderEmail(note, to.address, unsubscribeUrl ? { unsubscribeUrl } : {}),
        );
        return { ok: true, channel: "email", address: to.address };
      } catch (e) {
        return {
          ok: false,
          channel: "email",
          address: to.address,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}
