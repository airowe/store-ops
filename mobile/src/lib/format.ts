/**
 * Small, pure formatting helpers shared across screens. Honesty-aware: an
 * UNMEASURED value (null/undefined) renders as an explicit em-dash, NEVER as 0
 * or a guessed number — the same discipline the web and engine uphold.
 */

/** A rank like "#3", or "—" when unmeasured (null/undefined). */
export function formatRank(rank: number | null | undefined): string {
  return rank == null ? "—" : `#${rank}`;
}

/** A measured count, or "—" when unmeasured. Note: a real 0 stays "0". */
export function formatCount(n: number | null | undefined): string {
  return n == null ? "—" : String(n);
}

/** A score 0–100, or "?" when unknown/unreadable (null) — never a false 0. */
export function formatScore(score: number | null | undefined): string {
  return score == null ? "?" : String(Math.round(score));
}

/** Relative "time ago" for a run timestamp; falls back to the raw date string. */
export function timeAgo(iso: string, now: number): string {
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

/** Title-case a run status like "awaiting_approval" → "Awaiting approval". */
export function humanizeStatus(status: string): string {
  const s = status.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
