/**
 * GET /r/:appId — the PUBLIC report as a server-rendered PAGE (loop 2,
 * 2026-09-05). Pure: takes the same data `GET /report/:appId` returns and
 * produces HTML. No fetch, no DB, no env.
 *
 * Why a page and not the JSON + a client renderer: a crawler or an unfurler
 * sees only what is in the HTML. `docs/landing/report.html` renders the same
 * data in the browser, so every report there shares one title, one
 * description, one card, and none of the content is indexable. This module is
 * that renderer, ported, so each app gets its own page — served from the same
 * cache behind the same damper, so it costs no new upstream calls.
 *
 * Honesty rules (test-enforced in reportPage.spec.ts):
 *   - measured-or-nothing: an unreadable field is "—", a null rank is
 *     "— not in top 200", a null score is "—"; the description omits any
 *     clause whose number was not measured;
 *   - the thin-read caveat renders when fewer than half the fields were
 *     readable, exactly as report.html does;
 *   - every interpolated string is escaped.
 */
import type { AppPreview } from "../engine/preview.js";
import type { AuditCard, CardValue } from "../engine/auditCard.js";

export type ReportPageData = {
  appId: string;
  bundleId: string;
  country: string;
  preview: AppPreview;
  /** The shareable audit card (#437). Absent on cache entries written before it existed. */
  card?: AuditCard | undefined;
};

export type ReportPageOptions = {
  /** Origin used for the canonical + Open Graph URLs, e.g. "https://shipaso.com". */
  canonicalOrigin: string;
};

const DASH = "—";

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The canonical URL of a report page. Country rides along only when it is not the default. */
export function reportPagePath(appId: string, country: string): string {
  const c = country.toLowerCase();
  return `/r/${encodeURIComponent(appId)}${c === "us" ? "" : `?country=${encodeURIComponent(c)}`}`;
}

/**
 * The one-sentence description, built ONLY from measured fields. Each clause
 * is present when its number was measured and absent otherwise — never a 0 or
 * a placeholder standing in for "unknown".
 */
export function describeReport(p: AppPreview, appName: string): string {
  const clauses: string[] = [];
  if (typeof p.score === "number") {
    clauses.push(`scores ${p.score}/100 on ${p.fieldsMeasured} of ${p.fieldsTotal} readable listing fields`);
  }
  if (typeof p.leadRank === "number" && p.leadKeyword) {
    clauses.push(`ranks #${p.leadRank} for "${p.leadKeyword}"`);
  }
  if (p.keywordsChecked > 0) {
    clauses.push(`${p.inTop10} of ${p.keywordsChecked} checked keywords in the App Store top 10`);
  }
  const head = `${appName} ASO report`;
  if (clauses.length === 0) return `${head}: a measured, per-field App Store listing audit. Free, no signup.`;
  return `${head}: ${clauses.join("; ")}. Measured, not estimated. Free, no signup.`;
}

function fieldRow(f: AppPreview["breakdown"][number]): string {
  const unread = f.state === "unreadable" || f.score === null;
  const pct = unread ? 0 : Math.round(((f.score as number) / f.max) * 100);
  const flag = !unread && pct < 60;
  const cls = unread ? " unread" : flag ? " flag" : "";
  const pts = unread ? DASH : `${f.score}/${f.max}`;
  return (
    `<div class="frow"><div class="fname">${escapeHtml(f.field)}</div>` +
    `<div class="fnote${cls}">${escapeHtml(f.note)}</div>` +
    `<div class="fbar${unread ? " unread" : ""}"><i style="width:${pct}%"></i></div>` +
    `<div class="fpts">${pts}</div></div>`
  );
}

function rankText(r: number | null): string {
  return r === null ? `<span class="krank none">${DASH} not in top 200</span>` : `<span class="krank">#${r}</span>`;
}

const CSS =
  `:root{--bg:#07090e;--panel:#11151f;--line:#222a3b;--ink:#eef1f7;--dim:#97a1b6;--faint:#626c83;--signal:#34d399;--warn:#fbbf24;--bad:#f87171}` +
  `*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}` +
  `.wrap{max-width:820px;margin:0 auto;padding:28px 20px 64px}a{color:inherit}` +
  `.top{display:flex;align-items:center;gap:12px;margin-bottom:34px}.mark{font-weight:700;letter-spacing:.4px;color:var(--signal);text-decoration:none}.top .nav{margin-left:auto;font-size:14px}.top .nav a{color:var(--dim);text-decoration:none;margin-left:18px}` +
  `.apphead{display:flex;align-items:center;gap:18px;margin-bottom:22px}.apphead h1{font-size:28px;line-height:1.15;margin:0 0 4px}.sub{color:var(--dim);font-size:14px}` +
  `.ring{margin-left:auto;flex:none;width:84px;height:84px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--signal) calc(var(--pct)*1%),var(--line) 0);position:relative}.ring::before{content:"";position:absolute;inset:7px;border-radius:50%;background:var(--bg)}.ring .num{position:relative;font-weight:700;font-size:24px}` +
  `.msg{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;color:var(--dim);font-size:14.5px;margin:0 0 18px}` +
  `.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin:0 0 18px;overflow:hidden}.ph{padding:12px 16px;border-bottom:1px solid var(--line);font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}.pb{padding:6px 16px 12px}` +
  `.frow{display:grid;grid-template-columns:120px 1fr 120px 64px;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line);font-size:14.5px}.frow:last-child{border-bottom:none}.fname{font-weight:600;text-transform:capitalize}.fnote{color:var(--dim)}.fnote.flag{color:var(--warn)}.fnote.unread{color:var(--faint);font-style:italic}` +
  `.fbar{height:6px;border-radius:99px;background:var(--line);overflow:hidden}.fbar i{display:block;height:100%;background:var(--signal)}.fbar.unread i{background:transparent}.fpts{text-align:right;font-variant-numeric:tabular-nums;color:var(--dim)}` +
  `.kwrow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:15px}.kwrow:last-child{border-bottom:none}.krank{font-variant-numeric:tabular-nums;font-weight:600;color:var(--signal)}.krank.none{color:var(--faint);font-weight:400}` +
  `.close{margin-top:26px;padding:22px;border:1px solid var(--line);border-radius:12px;background:linear-gradient(180deg,rgba(52,211,153,.06),transparent)}.close h2{margin:0 0 8px;font-size:20px}.close p{color:var(--dim);margin:0 0 14px}` +
  `.btn{display:inline-block;padding:10px 16px;border-radius:9px;text-decoration:none;font-weight:600;font-size:14.5px;margin-right:10px;margin-bottom:8px}.btn-primary{background:var(--signal);color:#04110b}.btn-ghost{border:1px solid var(--line);color:var(--ink)}` +
  `footer{margin-top:34px;color:var(--faint);font-size:13.5px}@media(max-width:600px){.frow{grid-template-columns:1fr 64px;grid-template-areas:"n p" "t t" "b b"}.fname{grid-area:n}.fpts{grid-area:p}.fnote{grid-area:t}.fbar{grid-area:b}}`;

// ── the audit card (#437) ────────────────────────────────────────────────────
//
// One block sized to screenshot. Every value goes through `cardValue`, so a
// number cannot reach the page without its state: measured renders the value,
// pending renders "requested" with Apple's window, unavailable renders "—" with
// the reason, absent renders "—" alone. There is no fifth branch.

const CARD_CSS =
  `.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:0 0 22px}` +
  `.cid{display:flex;align-items:center;gap:14px;margin-bottom:14px}.cid img{width:56px;height:56px;border-radius:13px;flex:none}.cid h2{margin:0;font-size:20px;line-height:1.2}.cid .dev{color:var(--dim);font-size:14px}` +
  `.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}.chip{font-size:12.5px;padding:3px 9px;border:1px solid var(--line);border-radius:999px;color:var(--dim)}` +
  `.hl{font-size:19px;font-weight:700;line-height:1.3;margin:0 0 4px}.hls{color:var(--faint);font-size:12.5px;margin:0 0 16px}` +
  `.hero{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}.ht{border:1px solid var(--line);border-radius:10px;padding:12px 14px}.hk{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)}.hv{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;margin:2px 0}.hv.none{color:var(--faint)}.hr{font-size:12.5px;color:var(--faint)}` +
  `.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}.tile{border:1px solid var(--line);border-radius:10px;padding:10px 12px}.ck{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)}.cv{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}.cv.none{color:var(--faint);font-weight:400}.cv small{font-size:12.5px;color:var(--dim);font-weight:400}` +
  `.fx{border-top:1px solid var(--line);padding-top:12px;margin-top:4px}.fx .ft{font-weight:600;font-size:14.5px}.fx .ff{color:var(--dim);font-size:14px;margin-bottom:8px}` +
  `.strip{display:flex;gap:8px;margin-top:12px}.strip img{width:calc(33.333% - 6px);border-radius:8px;border:1px solid var(--line)}` +
  `.cfoot{display:flex;justify-content:space-between;margin-top:14px;font-size:12.5px;color:var(--faint)}` +
  `@media(max-width:600px){.tiles{grid-template-columns:1fr 1fr}}`;

/** Renders one CardValue as [value html, note html]. The four states, no default arm. */
function cardValue<T>(v: CardValue<T>, show: (value: T) => string): { html: string; note: string; none: boolean } {
  switch (v.state) {
    case "measured":
      return { html: show(v.value), note: "", none: false };
    case "pending":
      return { html: DASH, note: escapeHtml(v.reason), none: true };
    case "unavailable":
      return { html: DASH, note: escapeHtml(v.reason), none: true };
    case "absent":
      return { html: DASH, note: "", none: true };
  }
}

function heroTile(label: string, v: CardValue<number>): string {
  const r = cardValue(v, (n) => escapeHtml(n.toLocaleString("en-US")));
  return `<div class="ht"><div class="hk">${escapeHtml(label)}</div><div class="hv${r.none ? " none" : ""}">${r.html}</div>${r.note ? `<div class="hr">${r.note}</div>` : ""}</div>`;
}

function tile(label: string, r: { html: string; none: boolean }): string {
  return `<div class="tile"><div class="ck">${escapeHtml(label)}</div><div class="cv${r.none ? " none" : ""}">${r.html}</div></div>`;
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function renderCard(c: AuditCard, canonical: string): string {
  const dev = cardValue(c.identity.developer, (s) => escapeHtml(s));
  const category = cardValue(c.chips.category, (s) => escapeHtml(s));
  const price = cardValue(c.chips.price, (s) => escapeHtml(s));
  const released = cardValue(c.identity.released, (s) => `Since ${escapeHtml(dateOnly(s))}`);
  const chips = [category, price, released].filter((x) => !x.none).map((x) => `<span class="chip">${x.html}</span>`).join("");

  const rating = cardValue(c.tiles.rating, (r) => `${escapeHtml(r.avg.toFixed(1))} <small>★ ${escapeHtml(r.count.toLocaleString("en-US"))}</small>`);
  const size = cardValue(c.tiles.size, (s) => escapeHtml(s));
  const score = cardValue(c.aso.score, (n) => `${escapeHtml(String(n))}<small>/100${c.aso.grade ? ` · ${escapeHtml(c.aso.grade)}` : ""}</small>`);
  const rankNote = cardValue(c.aso.rankSummary, (s) => escapeHtml(`${s.found} of ${s.tested} keywords found`));

  const fixes = c.aso.topFindings
    .map((f) => `<div class="ft">${escapeHtml(f.title)}</div><div class="ff">${escapeHtml(f.fix)}</div>`)
    .join("");
  const strip = c.screenshots.map((u) => `<img src="${escapeHtml(u)}" alt="" loading="lazy">`).join("");

  return (
    `<section class="card" id="card">` +
    `<div class="cid">${c.identity.iconUrl ? `<img src="${escapeHtml(c.identity.iconUrl)}" alt="">` : ""}<div><h2>${escapeHtml(c.identity.name)}</h2>` +
    `<div class="dev">${dev.none ? DASH : dev.html}</div></div></div>` +
    (chips ? `<div class="chips">${chips}</div>` : "") +
    `<p class="hl">${escapeHtml(c.aso.headline)}</p>` +
    `<p class="hls">${c.aso.rankSummary.state === "measured" ? escapeHtml(c.aso.rankSummary.source) : "ShipASO rank check"}${rankNote.none ? "" : ` · ${rankNote.html}`}</p>` +
    `<div class="hero">${heroTile("Downloads", c.hero.downloads)}${heroTile("Proceeds", c.hero.proceeds)}</div>` +
    `<div class="tiles">${tile("Listing score", score)}${tile("Rating", rating)}${tile("Size", size)}</div>` +
    (fixes ? `<div class="fx">${fixes}</div>` : "") +
    (strip ? `<div class="strip">${strip}</div>` : "") +
    `<div class="cfoot"><span>Measured ${escapeHtml(dateOnly(c.measuredAt))} · ${escapeHtml(c.country)} · every number measured or ${DASH}</span><span>${escapeHtml(canonical.replace(/^https?:\/\//, ""))}</span></div>` +
    `</section>`
  );
}

function shell(title: string, head: string, body: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>${head}<style>${CSS}${CARD_CSS}</style></head><body><div class="wrap">` +
    `<div class="top"><a class="mark" href="https://shipaso.com">ShipASO</a><nav class="nav"><a href="https://shipaso.com/report">Score another app</a><a href="https://shipaso.com/install">Free plugin</a><a href="https://app.shipaso.com">Hosted agent</a></nav></div>` +
    body +
    `<footer><strong>ShipASO</strong> — MIT-licensed ASO for App Store &amp; Google Play. Every number on this page was measured from the public App Store, or shown as ${DASH}.</footer>` +
    `</div></body></html>`
  );
}

export function renderReportPage(data: ReportPageData, opts: ReportPageOptions): string {
  const p = data.preview;
  const appName = p.appName || data.bundleId || "This app";
  const country = (data.country || "us").toLowerCase();
  const canonical = `${opts.canonicalOrigin.replace(/\/$/, "")}${reportPagePath(data.appId, country)}`;
  const title = `${appName} — ASO report | ShipASO`;
  const description = describeReport(p, appName);

  const breakdown = Array.isArray(p.breakdown) ? p.breakdown : [];
  const sample = Array.isArray(p.sample) ? p.sample : [];
  const measured = p.fieldsMeasured;
  const total = p.fieldsTotal;
  const thin = total > 0 && measured < Math.ceil(total / 2);
  const scoreText = typeof p.score === "number" ? String(p.score) : DASH;
  const pct = typeof p.score === "number" ? p.score : 0;

  const head =
    `<meta name="description" content="${escapeHtml(description)}">` +
    `<link rel="canonical" href="${escapeHtml(canonical)}">` +
    `<meta property="og:type" content="article"><meta property="og:site_name" content="ShipASO">` +
    `<meta property="og:title" content="${escapeHtml(title)}">` +
    `<meta property="og:description" content="${escapeHtml(description)}">` +
    `<meta property="og:url" content="${escapeHtml(canonical)}">` +
    `<meta property="og:image" content="https://shipaso.com/og/card.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` +
    `<meta name="twitter:card" content="summary_large_image">`;

  let body =
    `<div class="apphead"><div><h1>${escapeHtml(appName)}</h1>` +
    `<div class="sub">${escapeHtml(data.bundleId)} · ${escapeHtml(country.toUpperCase())}` +
    (total ? ` · ${measured} of ${total} fields readable` : "") +
    `</div></div><div class="ring" style="--pct:${pct}"><span class="num">${scoreText}</span></div></div>`;

  if (thin) {
    body +=
      `<div class="msg">Heads up: only <b>${measured} of ${total}</b> fields were readable from the public App Store page, ` +
      `so this score reflects just those. Connect the app (or run the plugin with your key) to score the rest.</div>`;
  }

  if (data.card) body += renderCard(data.card, canonical);

  if (breakdown.length) {
    body += `<div class="panel"><div class="ph">Listing breakdown</div><div class="pb">${breakdown.map(fieldRow).join("")}</div></div>`;
  }

  if (sample.length) {
    body +=
      `<div class="panel"><div class="ph">Measured keyword ranks · ${p.keywordsChecked} checked, ${p.inTop10} in the top 10</div><div class="pb">` +
      sample.map((k) => `<div class="kwrow"><span class="kterm">${escapeHtml(k.keyword)}</span>${rankText(k.rank)}</div>`).join("") +
      `</div></div>`;
  }

  body +=
    `<div class="close"><h2>Now fix it — free.</h2>` +
    `<p>This is the audit. The <b>fix</b> is the char-limit-correct copy plus the exact push command — and it's free too. ` +
    `Install the plugin, run <code>/aso-audit</code>, and ship the improvement yourself. Nothing here gates the capability, only the remembering.</p>` +
    `<a class="btn btn-primary" href="https://shipaso.com/install">Get the free plugin</a>` +
    `<a class="btn btn-ghost" href="https://app.shipaso.com">Let the agent run it weekly</a></div>`;

  return shell(title, head, body);
}

/** An honest error page carrying the same message the JSON route would return. */
export function renderReportErrorPage(status: number, message: string): string {
  const title = status === 429 ? "One moment" : status === 404 ? "No app found" : status >= 500 ? "Couldn’t reach the App Store" : "That link isn’t a report";
  const body =
    `<div class="panel"><div class="ph">${escapeHtml(String(status))}</div><div class="pb" style="padding:16px">` +
    `<h1 style="font-size:22px;margin:0 0 8px">${escapeHtml(title)}</h1><p style="color:var(--dim);margin:0 0 14px">${escapeHtml(message)}</p>` +
    `<a class="btn btn-ghost" href="https://shipaso.com/report">Score an app</a></div></div>`;
  return shell(`${title} | ShipASO`, `<meta name="robots" content="noindex">`, body);
}
