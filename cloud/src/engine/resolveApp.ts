/**
 * Resolve whatever a user pastes into a connectable app.
 *
 * Connect used to require an exact `bundle_id`. This lets a user hand us any of:
 *   • an App Store URL   — https://apps.apple.com/.../id1600000000
 *   • a Google Play URL  — https://play.google.com/store/apps/details?id=com.foo
 *   • a numeric track id — 1600000000
 *   • a bundle / package — app.airowe.clarity
 *   • a plain app NAME   — "secular meditation"
 *
 * Everything funnels through the same free iTunes endpoints the rest of the
 * engine uses (no paid data API): name → /search, id/url → /lookup. Pure +
 * injectable (takes a FetchFn), so it unit-tests without a runtime.
 */
import { ITUNES_LOOKUP_URL, ITUNES_SEARCH_URL } from "./constants.js";
import {
  type FetchFn,
  type ItunesResult,
  asResponse,
  buildUrl,
  fetchJson,
} from "./itunes.js";

/** How many name-search candidates we surface for the user to pick from. */
export const MAX_CANDIDATES = 8;

/** The classification of a raw query string. */
export type Query =
  | { kind: "appstore-id"; id: string }
  | { kind: "bundle-id"; id: string }
  | { kind: "name"; term: string };

/** A connectable app candidate, normalized from an iTunes result. */
export type AppCandidate = {
  bundleId: string;
  name: string;
  publisher: string | null;
  genres: string[];
  trackId: number | null;
  iconUrl: string | null;
};

export type ResolveResult = {
  /**
   * resolved   — exactly one connectable match (connect can proceed directly)
   * candidates — several matches; the user must pick one
   * not-found  — nothing connectable matched
   */
  kind: "resolved" | "candidates" | "not-found";
  query: Query;
  candidates: AppCandidate[];
};

const APPSTORE_ID_RE = /\bid(\d+)/i; // .../id1600000000 (anywhere in an apps.apple.com URL)
const PLAY_ID_RE = /[?&]id=([^&]+)/; // play.google.com/...?id=com.foo
const NUMERIC_RE = /^\d+$/;
// A bundle/package id: dot-separated tokens, no spaces (com.foo.bar, app.airowe.x).
const BUNDLE_RE = /^[A-Za-z][\w-]*(\.[A-Za-z0-9][\w-]*)+$/;

/** Classify a raw query string into how we should resolve it. */
export function classifyQuery(raw: string): Query {
  const q = raw.trim();

  if (/^https?:\/\//i.test(q)) {
    // Apple store link → numeric track id.
    if (/apps\.apple\.com/i.test(q)) {
      const m = q.match(APPSTORE_ID_RE);
      if (m?.[1]) return { kind: "appstore-id", id: m[1] };
    }
    // Play store link → the `id=` param IS the package (a bundle id).
    if (/play\.google\.com/i.test(q)) {
      const m = q.match(PLAY_ID_RE);
      if (m?.[1]) return { kind: "bundle-id", id: decodeURIComponent(m[1]) };
    }
    // Unknown URL → fall through and treat the whole thing as a name search.
    return { kind: "name", term: q };
  }

  if (NUMERIC_RE.test(q)) return { kind: "appstore-id", id: q };
  if (BUNDLE_RE.test(q)) return { kind: "bundle-id", id: q };
  return { kind: "name", term: q };
}

/** Normalize an iTunes software result into a connectable candidate (or null). */
function toCandidate(r: ItunesResult): AppCandidate | null {
  const result = r as ItunesResult & {
    artistName?: string;
    artworkUrl100?: string;
    artworkUrl60?: string;
  };
  // No bundleId → we can't connect/run it; drop it.
  if (!result.bundleId) return null;
  return {
    bundleId: result.bundleId,
    name: result.trackName ?? result.bundleId,
    publisher: result.artistName ?? null,
    genres: result.genres ?? [],
    trackId: result.trackId ?? null,
    iconUrl: result.artworkUrl100 ?? result.artworkUrl60 ?? null,
  };
}

async function lookupCandidates(
  fetchFn: FetchFn,
  by: "id" | "bundleId",
  key: string,
  country: string,
): Promise<AppCandidate[]> {
  const params: Record<string, string> = { country };
  params[by] = key;
  const data = asResponse(await fetchJson(fetchFn, buildUrl(ITUNES_LOOKUP_URL, params)));
  return (data.results ?? []).map(toCandidate).filter((c): c is AppCandidate => c !== null);
}

async function searchCandidates(
  fetchFn: FetchFn,
  term: string,
  country: string,
): Promise<AppCandidate[]> {
  const data = asResponse(
    await fetchJson(
      fetchFn,
      buildUrl(ITUNES_SEARCH_URL, {
        term,
        country,
        entity: "software",
        limit: MAX_CANDIDATES,
      }),
    ),
  );
  return (data.results ?? []).map(toCandidate).filter((c): c is AppCandidate => c !== null);
}

/**
 * Resolve a raw query to connectable candidates. Never throws on "nothing
 * found" — that's the `not-found` result; it only throws if the upstream fetch
 * itself fails irrecoverably (mirrors the rest of the engine's posture).
 */
export async function resolveAppQuery(
  fetchFn: FetchFn,
  raw: string,
  { country = "US" }: { country?: string } = {},
): Promise<ResolveResult> {
  const query = classifyQuery(raw);

  let candidates: AppCandidate[];
  if (query.kind === "appstore-id") {
    candidates = await lookupCandidates(fetchFn, "id", query.id, country);
  } else if (query.kind === "bundle-id") {
    candidates = await lookupCandidates(fetchFn, "bundleId", query.id, country);
  } else {
    candidates = await searchCandidates(fetchFn, query.term, country);
  }

  const kind =
    candidates.length === 0 ? "not-found" : candidates.length === 1 ? "resolved" : "candidates";
  return { kind, query, candidates };
}
