/**
 * The audit card (#437, analytics-reports PRD 05) — the pure model.
 *
 * A shareable, screenshot-shaped summary of one app's audit. The competitor's
 * card is inventory plus two MODELED hero numbers; ours is inventory plus the
 * FINDING, and every number carries where and when it was measured.
 *
 * `CardValue` is the load-bearing type: a four-state union, so a number cannot
 * be rendered without its provenance and "pending" is distinguishable from
 * "zero" in the type system. Measured-or-nothing, structurally.
 *
 * v1 (owner decision 2026-09-05): neither downloads nor proceeds. Both hero
 * tiles are `unavailable` with the reason; no code path here can emit an
 * estimated figure because there is no field to put one in.
 *
 * Pure: no fetch, no DB, no clock — `now` is an input.
 */
import type { ItunesResult } from "./itunes.js";
import type { Rank } from "./rankCheck.js";
import { sortFindings, type Finding } from "./findings/core.js";

export type CardValue<T> =
  | { state: "measured"; value: T; asOf: string; source: string }
  | { state: "pending"; reason: string }
  | { state: "unavailable"; reason: string }
  | { state: "absent" };

export type RankSummaryValue = {
  tested: number;
  found: number;
  best: { keyword: string; rank: number } | null;
};

export type AuditCard = {
  identity: {
    name: string;
    developer: CardValue<string>;
    iconUrl: string | null;
    released: CardValue<string>;
    lastUpdated: CardValue<string>;
  };
  chips: { category: CardValue<string>; price: CardValue<string> };
  hero: { downloads: CardValue<number>; proceeds: CardValue<number> };
  tiles: { rating: CardValue<{ avg: number; count: number }>; size: CardValue<string> };
  aso: {
    headline: string;
    score: CardValue<number>;
    grade: string | null;
    rankSummary: CardValue<RankSummaryValue>;
    topFindings: Finding[];
  };
  screenshots: string[];
  measuredAt: string;
  country: string;
};

export type AuditCardInput = {
  listing: ItunesResult;
  score: number | null;
  grade: string | null;
  ranks: Rank[];
  findings: Finding[];
  country: string;
  /** ISO timestamp of the measurement — an input so the card is reproducible. */
  now: string;
};

const STORE = "App Store";
/** Two findings fit a card; more turns it back into the report. */
const TOP_FINDINGS = 2;
const STRIP = 3;

const measured = <T>(value: T, asOf: string, source: string): CardValue<T> => ({ state: "measured", value, asOf, source });
const unavailable = <T>(reason: string): CardValue<T> => ({ state: "unavailable", reason });
const ABSENT = { state: "absent" } as const;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** "52428800" → "50 MB"; a non-numeric or missing size is unavailable. */
function formatBytes(raw: unknown): string | null {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const mb = n / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** Ranks whose fetch succeeded — an error is "not measured", never a miss. */
function measuredRanks(ranks: readonly Rank[]): Rank[] {
  return ranks.filter((r) => !r.error);
}

function summarizeRanks(ranks: readonly Rank[]): RankSummaryValue | null {
  const ok = measuredRanks(ranks);
  if (ok.length === 0) return null;
  const found = ok.filter((r) => r.rank !== null);
  let best: RankSummaryValue["best"] = null;
  for (const r of found) {
    if (r.rank !== null && (best === null || r.rank < best.rank)) best = { keyword: r.keyword, rank: r.rank };
  }
  return { tested: ok.length, found: found.length, best };
}

/**
 * The sentence no scraper can write: how many of the keywords we actually
 * tested the app was found for, and its best measured position.
 */
export function asoHeadline(ranks: readonly Rank[]): string {
  const s = summarizeRanks(ranks);
  if (s === null) return "No keywords measured yet.";
  if (s.best === null) return `Not found for any of the ${s.tested} keywords tested (top 200).`;
  return `Found for ${s.found} of ${s.tested} keywords tested. Best rank #${s.best.rank} for “${s.best.keyword}”.`;
}

export function auditCard(input: AuditCardInput): AuditCard {
  const { listing: l, now } = input;
  const country = input.country.toUpperCase();

  const developer = str(l.sellerName);
  const category = str(l.primaryGenreName) ?? str(l.genres?.[0]);
  const price = str(l.formattedPrice);
  const size = formatBytes(l.fileSizeBytes);
  const released = str(l.releaseDate);
  const updated = str(l.currentVersionReleaseDate);
  const count = typeof l.userRatingCount === "number" && Number.isFinite(l.userRatingCount) ? l.userRatingCount : null;
  const avg = typeof l.averageUserRating === "number" && Number.isFinite(l.averageUserRating) ? l.averageUserRating : null;

  let rating: CardValue<{ avg: number; count: number }>;
  if (count === null || avg === null) rating = unavailable("Rating not readable from the public listing.");
  else if (count === 0) rating = ABSENT;
  else rating = measured({ avg: Math.round(avg * 10) / 10, count }, now, STORE);

  const rankSummary = summarizeRanks(input.ranks);
  const icon = str(l.artworkUrl512) ?? str(l.artworkUrl100) ?? str(l.artworkUrl60);

  return {
    identity: {
      name: str(l.trackName) ?? str(l.bundleId) ?? "This app",
      developer: developer ? measured(developer, now, STORE) : unavailable("Developer name not readable from the public listing."),
      iconUrl: icon,
      released: released ? measured(released, now, STORE) : unavailable("Release date not readable from the public listing."),
      lastUpdated: updated ? measured(updated, now, STORE) : unavailable("Last-update date not readable from the public listing."),
    },
    chips: {
      category: category ? measured(category, now, STORE) : unavailable("Category not readable from the public listing."),
      price: price ? measured(price, now, STORE) : unavailable("Price not readable from the public listing."),
    },
    hero: {
      downloads: unavailable(
        "Apple reports downloads only to the app's own developer. Connect an App Store Connect key with the Admin role to measure them.",
      ),
      proceeds: unavailable("Not in this version of the card."),
    },
    tiles: {
      rating,
      size: size ? measured(size, now, STORE) : unavailable("Size not readable from the public listing."),
    },
    aso: {
      headline: asoHeadline(input.ranks),
      score: typeof input.score === "number" ? measured(input.score, now, "ShipASO listing audit") : ABSENT,
      grade: input.grade,
      rankSummary: rankSummary ? measured(rankSummary, now, `ShipASO rank check · ${country} · top 200`) : ABSENT,
      topFindings: sortFindings(input.findings.filter((f) => f.context === undefined && (f.severity === "critical" || f.severity === "warn"))).slice(
        0,
        TOP_FINDINGS,
      ),
    },
    screenshots: (l.screenshotUrls ?? []).filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, STRIP),
    measuredAt: now,
    country,
  };
}
