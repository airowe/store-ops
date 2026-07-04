/**
 * Competitor listing watch — ported from aso_competitor_watch.py.
 *
 * Pull a competitor's VISIBLE App Store listing fields (name, version, price,
 * rating, genres) via the free iTunes Lookup API and diff them against a prior
 * snapshot. iTunes does not expose a competitor's private keyword field, so we
 * track exactly what users see — which is where most ASO moves surface.
 *
 * `resolveNameToId` lets a context list competitors by NAME (resolves to the top
 * software result's trackId via the Search endpoint), per the Python helper.
 */
import { ITUNES_LOOKUP_URL, ITUNES_SEARCH_URL } from "./constants.js";
import {
  asResponse,
  buildUrl,
  type FetchFn,
  fetchJson,
  type ItunesResult,
} from "./itunes.js";

/** The visible listing fields we track for change (Python WATCH_FIELDS). */
export const WATCH_FIELDS = [
  "name",
  "subtitle",
  "version",
  "price",
  "rating",
  "genres",
] as const;
export type WatchField = (typeof WATCH_FIELDS)[number];

export type Listing = {
  /** the id or bundle we looked up by. */
  key: string;
  name: string;
  /** iTunes rarely returns subtitle; kept for completeness/parity. */
  subtitle: string;
  version: string;
  price: string;
  rating: string;
  genres: string;
  error: string;
};

function emptyListing(key: string, error = ""): Listing {
  return { key, name: "", subtitle: "", version: "", price: "", rating: "", genres: "", error };
}

/** Map a raw iTunes result into a Listing (price/rating formatting from Python). */
function resultToListing(key: string, r: ItunesResult): Listing {
  const price =
    r.formattedPrice ?? (r.price ? `$${r.price}` : "Free");
  let rating = "";
  if (r.averageUserRating !== undefined && r.averageUserRating !== null) {
    rating = `${Math.round(r.averageUserRating * 10) / 10} (${r.userRatingCount ?? 0})`;
  }
  return {
    key,
    name: r.trackName ?? "",
    subtitle: "",
    version: r.version ?? "",
    price,
    rating,
    genres: (r.genres ?? []).join(", "),
    error: "",
  };
}

/** Extract just the watched fields of a Listing (Python `Listing.watched`). */
export function watched(l: Listing): Record<WatchField, string> {
  return {
    name: l.name,
    subtitle: l.subtitle,
    version: l.version,
    price: l.price,
    rating: l.rating,
    genres: l.genres,
  };
}

/** Look up one competitor by App Store id (`by="id"`) or bundleId. */
export async function lookup(
  fetchFn: FetchFn,
  key: string,
  { by = "id", country = "US" }: { by?: "id" | "bundleId"; country?: string } = {},
): Promise<Listing> {
  const params: Record<string, string> = { country };
  params[by === "id" ? "id" : "bundleId"] = key;
  let data;
  try {
    data = asResponse(await fetchJson(fetchFn, buildUrl(ITUNES_LOOKUP_URL, params)));
  } catch (e) {
    return emptyListing(key, e instanceof Error ? e.message : String(e));
  }
  const results = data.results ?? [];
  if (results.length === 0) return emptyListing(key, "not found");
  return resultToListing(key, results[0] as ItunesResult);
}

/**
 * Resolve a competitor app NAME to its App Store track id via iTunes Search
 * (top software result's trackId), or null. Never throws — returns null on any
 * failure, mirroring the Python broad-except.
 */
export async function resolveNameToId(
  fetchFn: FetchFn,
  name: string,
  { country = "US" }: { country?: string } = {},
): Promise<string | null> {
  try {
    const url = buildUrl(ITUNES_SEARCH_URL, {
      term: name,
      country,
      entity: "software",
      limit: 1,
    });
    const data = asResponse(await fetchJson(fetchFn, url));
    const tid = data.results?.[0]?.trackId;
    return tid ? String(tid) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a competitor app NAME directly to its `bundleId` via iTunes Search
 * (top software result), or null. `rankFor` matches on bundleId, so the war room
 * (PRD 05) uses this to turn a selected competitor name into something it can
 * rank-check. One round-trip; never throws (returns null on any failure).
 */
export async function resolveNameToBundle(
  fetchFn: FetchFn,
  name: string,
  { country = "US" }: { country?: string } = {},
): Promise<string | null> {
  try {
    const url = buildUrl(ITUNES_SEARCH_URL, {
      term: name,
      country,
      entity: "software",
      limit: 1,
    });
    const data = asResponse(await fetchJson(fetchFn, url));
    const bundle = data.results?.[0]?.bundleId;
    return bundle ? String(bundle) : null;
  } catch {
    return null;
  }
}

/** Look up several competitors in sequence (errors captured per-listing). */
export async function lookupAll(
  fetchFn: FetchFn,
  keys: string[],
  { by = "id", country = "US" }: { by?: "id" | "bundleId"; country?: string } = {},
): Promise<Listing[]> {
  const out: Listing[] = [];
  for (const k of keys) out.push(await lookup(fetchFn, k, { by, country }));
  return out;
}

export type Change =
  | { key: string; status: "error"; detail: string }
  | { key: string; status: "new"; name: string }
  | { key: string; status: "same"; name: string }
  | {
      key: string;
      status: "changed";
      name: string;
      fields: Record<string, { from: string; to: string }>;
    };

/**
 * Per competitor, list which watched fields changed since the previous snapshot.
 * `prev` is keyed by the same id/bundle key. Ported from Python `diff`:
 *   • error → status "error"
 *   • not in prev → "new"
 *   • a watched field differs (and the new value is non-empty) → "changed"
 *   • otherwise → "same"
 */
export function diff(current: Listing[], prev: Record<string, Record<string, string>>): Change[] {
  const changes: Change[] = [];
  for (const c of current) {
    if (c.error) {
      changes.push({ key: c.key, status: "error", detail: c.error });
      continue;
    }
    const pv = prev[c.key];
    const cur = watched(c);
    if (pv === undefined) {
      changes.push({ key: c.key, status: "new", name: c.name });
      continue;
    }
    const fields: Record<string, { from: string; to: string }> = {};
    for (const f of WATCH_FIELDS) {
      const to = cur[f];
      const from = pv[f] ?? "";
      if (String(from) !== String(to) && to !== "") fields[f] = { from, to };
    }
    if (Object.keys(fields).length > 0) {
      changes.push({ key: c.key, status: "changed", name: c.name, fields });
    } else {
      changes.push({ key: c.key, status: "same", name: c.name });
    }
  }
  return changes;
}

/** One-line digest of a change set (Python `digest_line`). */
export function digestLine(changes: Change[]): string {
  const chg = changes.filter((c) => c.status === "changed").length;
  const nw = changes.filter((c) => c.status === "new").length;
  const err = changes.filter((c) => c.status === "error").length;
  const parts: string[] = [];
  if (chg) parts.push(`${chg} changed`);
  if (nw) parts.push(`${nw} new`);
  if (err) parts.push(`${err} err`);
  return parts.length ? parts.join(", ") : "no changes";
}

// ── Competitor auto-discovery (#72-C) ─────────────────────────────────────────

export type DiscoveredCompetitor = {
  /** App Store trackId, stringified — the watch key `lookup` uses. */
  key: string;
  name: string;
  /** which of the app's tracked keywords this app surfaced for (≥1). */
  matchedKeywords: string[];
};

/**
 * Discover competitor CANDIDATES from real iTunes search results: search each of
 * the app's tracked keywords, collect the top software results, drop the app
 * itself, and rank by how many keywords each app surfaced for (then by best
 * position). These are honest candidates — apps genuinely competing for the same
 * searches — but they are SUGGESTIONS: the caller stores them unconfirmed and a
 * human promotes them to watched (#72's "auto-discover, user confirms" hybrid).
 *
 * Never throws: a failed keyword search contributes nothing (partial results
 * beat a dead feature); zero keywords → [] (we never invent seeds).
 */
export async function discoverCompetitors(
  fetchFn: FetchFn,
  opts: {
    keywords: string[];
    /** the app's own identity, excluded from candidates. */
    selfBundleId?: string;
    selfName?: string;
    country?: string;
    /** max candidates returned (default 8). */
    limit?: number;
    /** results fetched per keyword search (default 10). */
    perKeyword?: number;
  },
): Promise<DiscoveredCompetitor[]> {
  const country = opts.country ?? "US";
  const limit = opts.limit ?? 8;
  const perKeyword = opts.perKeyword ?? 10;
  const selfName = opts.selfName?.trim().toLowerCase();

  type Agg = { key: string; name: string; matched: Set<string>; bestPos: number };
  const byKey = new Map<string, Agg>();

  for (const kw of opts.keywords) {
    const term = kw.trim();
    if (!term) continue;
    let results: ItunesResult[];
    try {
      const url = buildUrl(ITUNES_SEARCH_URL, {
        term,
        country,
        entity: "software",
        limit: String(perKeyword),
      });
      results = asResponse(await fetchJson(fetchFn, url)).results ?? [];
    } catch {
      continue; // partial discovery beats none — this keyword contributes nothing
    }
    results.forEach((r, pos) => {
      const tid = r.trackId ? String(r.trackId) : null;
      if (!tid || !r.trackName) return;
      // never suggest the app to itself (by bundle id, or name as a fallback)
      if (opts.selfBundleId && r.bundleId === opts.selfBundleId) return;
      if (selfName && r.trackName.trim().toLowerCase() === selfName) return;
      const agg = byKey.get(tid) ?? { key: tid, name: r.trackName, matched: new Set<string>(), bestPos: pos };
      agg.matched.add(term);
      if (pos < agg.bestPos) agg.bestPos = pos;
      byKey.set(tid, agg);
    });
  }

  return [...byKey.values()]
    .sort((a, b) => b.matched.size - a.matched.size || a.bestPos - b.bestPos || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((a) => ({ key: a.key, name: a.name, matchedKeywords: [...a.matched] }));
}
