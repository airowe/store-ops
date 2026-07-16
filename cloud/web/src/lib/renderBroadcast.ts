// Mirror of cloud/src/broadcast.ts renderBroadcast — keep in sync (used for the compose preview).
/**
 * Minimal, dependency-free markdown → {html, text} for launch/newsletter emails.
 * Supports: # / ## / ### headings, blank-line-separated paragraphs, **bold**,
 * [text](url) links, and - unordered lists. Everything is HTML-escaped first, so
 * source markdown can never inject markup. Not a general markdown engine — just
 * what a broadcast needs (YAGNI). The send engine and the UI preview share this.
 */

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
