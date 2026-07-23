/**
 * Share-a-win card — a PURE builder for a branded, self-contained SVG that shows
 * a real rank win ("budget tracker  #40 → #12  ▲ up 28"), designed to be
 * screenshotted/posted. It consumes the same delta payload the dashboard already
 * has (`RankDeltaView`), picks the honest top win, and emits an SVG string with
 * no external fonts or references so it rasterizes to PNG client-side cleanly.
 *
 * Honesty bar (matches /proof): we only ever offer a win that's a genuine climb
 * or a strong new entry — never a hold or a slip. Better to show nothing than to
 * dress up a non-result.
 */
import type { DigestDirection, RankDeltaView } from "./digest.js";

export type ShareWin = {
  keyword: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  direction: DigestDirection;
};

export type ShareCardOpts = { size: "wide" | "square"; appName: string };

/** A "new" entry only counts as brag-worthy if it landed in a strong position. */
const STRONG_NEW_MAX = 50;

/**
 * Pick the single honest win to share, or null when there isn't one. The deltas
 * view is already ordered biggest-mover-first, so the first qualifying entry is
 * the best one: a climb ("up"), or a "new" entry that debuted at #STRONG_NEW_MAX
 * or better. Holds, slips, drops, and weak debuts return null.
 */
export function pickShareWin(view: RankDeltaView): ShareWin | null {
  for (const e of view.entries) {
    if (e.direction === "up" && e.current !== null) return { ...e };
    if (e.direction === "new" && e.current !== null && e.current <= STRONG_NEW_MAX) {
      return { ...e };
    }
  }
  return null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// System font stack (no embedded/remote fonts → the SVG is fully self-contained
// and safe to rasterize to a canvas without tainting).
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";

// The boat mark, scaled/translated into the card. Mirrors docs/brand/shipaso-icon.svg.
function boatMark(x: number, y: number, scale: number): string {
  const s = scale / 32; // the icon's native viewBox is 32×32
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect width="32" height="32" rx="7" fill="#0b0e14"/>
    <g fill="#34d399"><path d="M16 6 L8.5 17 h15 Z"/><path d="M5.5 19 h21 l-3 5 H8.5 Z"/></g>
    <line x1="16" y1="8" x2="16" y2="17" stroke="#0b0e14" stroke-width="1.5"/>
  </g>`;
}

/** Headline phrasing for the win, e.g. "up 28 spots" or "new — debuted at #22". */
function headline(win: ShareWin): string {
  if (win.direction === "new") return "new — debuted strong";
  const n = Math.abs(win.delta ?? 0);
  return `up ${n} spot${n === 1 ? "" : "s"}`;
}

/**
 * Render the branded SVG. `wide` (1200×630) is the OG/Twitter card ratio; `square`
 * (1080×1080) suits Instagram/threads. Both are dark with the signal-green accent
 * and the inlined boat mark — the same design language as the digest email.
 */
export function renderShareCardSvg(win: ShareWin, opts: ShareCardOpts): string {
  const W = opts.size === "wide" ? 1200 : 1080;
  const H = opts.size === "wide" ? 630 : 1080;
  const cx = W / 2;

  const kw = escapeXml(win.keyword);
  const cur = win.current === null ? "—" : `#${win.current}`;
  const prev = win.previous === null ? null : `#${win.previous}`;
  const app = escapeXml(opts.appName);

  // vertical rhythm differs a touch between the two ratios; the square layout is
  // centered tighter so it doesn't leave a big dead zone at the bottom.
  const brandY = opts.size === "wide" ? 96 : 230;
  const kwY = opts.size === "wide" ? 250 : 470;
  const moveY = opts.size === "wide" ? 400 : 680;
  const headY = opts.size === "wide" ? 500 : 820;
  const footY = H - 70;

  // the before→after line: "#40 → #12" for a climb, just "#12" for a new entry
  const moveLine = prev
    ? `<tspan fill="#828ca3">${prev}</tspan><tspan fill="#828ca3" dx="22" dy="0"> → </tspan><tspan fill="#34d399" dx="22">${cur}</tspan>`
    : `<tspan fill="#34d399">${cur}</tspan>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b0e14"/>
      <stop offset="1" stop-color="#07090e"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="#34d399"/>
  ${boatMark(cx - 26, brandY - 26, 52)}
  <text x="${cx}" y="${brandY + 78}" text-anchor="middle" fill="#eef1f7" font-size="40" font-weight="700" letter-spacing="1">ShipASO</text>
  <text x="${cx}" y="${kwY}" text-anchor="middle" fill="#97a1b6" font-size="30" font-family="${MONO}">${kw} · ${app}</text>
  <text x="${cx}" y="${moveY}" text-anchor="middle" font-size="${opts.size === "wide" ? 132 : 150}" font-weight="800" font-family="${MONO}">${moveLine}</text>
  <text x="${cx}" y="${headY}" text-anchor="middle" fill="#34d399" font-size="40" font-weight="700">▲ ${headline(win)}</text>
  <text x="${cx}" y="${footY}" text-anchor="middle" fill="#828ca3" font-size="26" font-family="${MONO}">shipaso.com · real organic rank, proven</text>
</svg>`;
}
