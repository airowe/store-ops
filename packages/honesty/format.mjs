/**
 * Pure formatting helpers — ported verbatim from `mobile/src/lib/format.ts`.
 * Honesty-aware: an UNMEASURED value (null/undefined) renders as an explicit
 * em-dash, NEVER 0 or a guess — the discipline the web + engine also uphold.
 * Shared so web and native format identically.
 */

/** A rank like "#3", or "—" when unmeasured (null/undefined). */
export function formatRank(rank) {
  return rank == null ? "—" : `#${rank}`;
}

/** A measured count, or "—" when unmeasured. A real 0 stays "0". */
export function formatCount(n) {
  return n == null ? "—" : String(n);
}

/** A score 0–100, or "?" when unknown/unreadable (null) — never a false 0. */
export function formatScore(score) {
  return score == null ? "?" : String(Math.round(score));
}

/** Relative "time ago" for a timestamp; falls back to the raw date string. */
export function timeAgo(iso, now) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Title-case a status like "awaiting_approval" → "Awaiting approval". */
export function humanizeStatus(status) {
  const s = status.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
