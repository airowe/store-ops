/**
 * Derivations for /competitors (#356). Pure, so the honesty rules are provable
 * without a DOM.
 *
 * Watching is a per-(app, rival) fact: `PortfolioRivalPair.status` belongs to
 * the pair, not the rival. So a rival is "watched" when at LEAST one pair is
 * confirmed, and the card's meta counts both numbers off the pairs actually
 * received — nothing here estimates, and nothing carries a shared-term count,
 * which the API deliberately does not expose (see `PortfolioRivalPair`).
 */
import type { PortfolioRival, PortfolioRivalPair } from "@shipaso/api";

/** Same value as `Competitor.status`; only this one ever feeds a run. */
export const CONFIRMED = "confirmed";

export const isConfirmed = (p: PortfolioRivalPair) => p.status === CONFIRMED;

export const confirmedPairs = (r: PortfolioRival) => r.pairs.filter(isConfirmed);

/** Watched = confirmed on at least one app. A rival confirmed nowhere is a suggestion. */
export const isWatched = (r: PortfolioRival) => r.pairs.some(isConfirmed);

/** "overlaps N of your apps · watched on M" — both counted, never estimated. */
export function rivalMeta(r: PortfolioRival): string {
  const overlaps = r.pairs.length;
  const watched = confirmedPairs(r).length;
  return `overlaps ${overlaps} of your ${overlaps === 1 ? "app" : "apps"} · watched on ${watched}`;
}

/** "N rivals · M app pairs" for the watched section — confirmed pairs only. */
export function watchedSummary(watched: PortfolioRival[]): string {
  const pairs = watched.reduce((n, r) => n + confirmedPairs(r).length, 0);
  return `${watched.length} ${watched.length === 1 ? "rival" : "rivals"} · ${pairs} app ${pairs === 1 ? "pair" : "pairs"}`;
}

export type Suggestion = { rival: PortfolioRival; pair: PortfolioRivalPair };

/**
 * The suggested grid is FLAT (one card per rival × app), while the watched
 * section groups by rival. Deliberate asymmetry: a suggestion is inherently
 * about one app, because you confirm it for one app.
 *
 * A rival watched somewhere keeps its unconfirmed pairs inside its own card as
 * inline confirms, so they are not repeated down here.
 */
export function suggestions(rivals: PortfolioRival[]): Suggestion[] {
  return rivals
    .filter((r) => !isWatched(r))
    .flatMap((rival) => rival.pairs.filter((p) => !isConfirmed(p)).map((pair) => ({ rival, pair })));
}

/**
 * Names where a suggestion came from, from the pair's own `source`. An unknown
 * source is reported as-is rather than being dressed up as one of the two we
 * know about — labelling a suggestion with a source it didn't come from is the
 * exact failure this wording exists to avoid.
 */
export function sourceLabel(source: string): string {
  if (source === "similar") return "from Apple’s similar apps";
  if (source === "keywords") return "from your tracked keywords";
  if (source === "user") return "added by you";
  return `from ${source}`;
}

/** First letter of the rival's name for the card's avatar. */
export const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
