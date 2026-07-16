/**
 * Minimal, dependency-free markdown → {html, text} for launch/newsletter emails.
 * Supports: # / ## / ### headings, blank-line-separated paragraphs, **bold**,
 * [text](url) links, and - unordered lists. Everything is HTML-escaped first, so
 * source markdown can never inject markup. Not a general markdown engine — just
 * what a broadcast needs (YAGNI). The send engine and the UI preview share this.
 *
 * Mirrored at cloud/web/src/lib/renderBroadcast.ts for the compose preview
 * (the worker's cloud/src is not importable by the web app) — keep in sync.
 */
import type { Env } from "./index.js";
import { emailSenderForEnv } from "./emailSender.js";
import { mintListUnsubToken } from "./auth.js";
// NOTE: do NOT import sessionSecret from ./api/index.js — api/index.ts imports
// this file, so that would be a circular import. Read env.SESSION_SECRET directly.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string): string {
  // escape first, then re-introduce ONLY our whitelisted inline markup
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

export function renderBroadcast(_subject: string, markdown: string): { html: string; text: string } {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list.length) { blocks.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`); list = []; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^-\s+(.*)$/.exec(line);
    if (h) { flushPara(); flushList(); const n = (h[1] ?? "").length; blocks.push(`<h${n}>${inline(h[2] ?? "")}</h${n}>`); }
    else if (li) { flushPara(); list.push(li[1] ?? ""); }
    else if (line.trim() === "") { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();

  const body = blocks.join("\n");
  const html =
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;` +
    `max-width:560px;margin:0 auto;padding:24px;color:#1a1d24;line-height:1.55">${body}</body></html>`;

  // plaintext: strip our markup
  const text = markdown
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/^-\s+/gm, "• ")
    .trim();

  return { html, text };
}

const CHUNK = 20;
const CHUNK_DELAY_MS = 1000;
const UNSUB_TTL = 60 * 60 * 24 * 90; // 90 days

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send a rendered broadcast to a recipient list in rate-limited chunks. Each
 *  email carries a one-click List-Unsubscribe (header + footer link) with a
 *  signed list-unsub token. Per-email failures are caught + logged. */
export async function sendBroadcastToList(args: {
  env: Env;
  subject: string;
  markdown: string;
  recipients: { email: string }[];
  baseUrl: string;
}): Promise<{ sent: number; failed: number }> {
  const { env, subject, markdown, recipients, baseUrl } = args;
  const sender = emailSenderForEnv(env);
  const secret = env.SESSION_SECRET ?? "";
  let sentN = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += CHUNK) {
    const batch = recipients.slice(i, i + CHUNK);
    await Promise.all(
      batch.map(async ({ email }) => {
        try {
          const token = await mintListUnsubToken(secret, email, { ttlSeconds: UNSUB_TTL });
          const unsubUrl = `${baseUrl}/list/unsubscribe?token=${encodeURIComponent(token)}`;
          const { html, text } = renderBroadcast(subject, markdown);
          const footer = `<hr/><p style="color:#97a1b6;font-size:12px">You're getting this because you signed up for ShipASO updates. <a href="${unsubUrl}">Unsubscribe</a>.</p>`;
          const htmlWithFooter = html.replace("</body>", `${footer}</body>`);
          await sender.send({
            to: email,
            subject,
            html: htmlWithFooter,
            text: `${text}\n\nUnsubscribe: ${unsubUrl}`,
            headers: {
              "List-Unsubscribe": `<${unsubUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          });
          sentN++;
        } catch (e) {
          failed++;
          console.error(`[store-ops] broadcast send failed for ${email}: ${String(e)}`);
        }
      }),
    );
    if (i + CHUNK < recipients.length) await sleep(CHUNK_DELAY_MS);
  }
  console.log(`[store-ops] broadcast "${subject}": sent ${sentN}/${recipients.length} (failed ${failed})`);
  return { sent: sentN, failed };
}
