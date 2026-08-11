/**
 * The neighbour set for the icon comparison (#455) — who your icon is measured
 * against, and where their artwork comes from.
 *
 * `chartRank.ts` already fetches your category chart and `parseChartFeed` already
 * returns the full ordered id list; it just reduces that to `indexOf(appId)` for
 * its own purpose. This takes the same list and answers the other question: which
 * apps sit at the top of your category, and what do their icons look like?
 *
 * The chart feed carries only `im:id` — no names, no artwork — so artwork costs
 * one iTunes Lookup. Apple's Lookup accepts a COMMA-SEPARATED id list, so the
 * whole neighbour set is ONE request, not one per app.
 *
 * Three facts about that endpoint, verified against it rather than assumed, that
 * the code below depends on:
 *   • results come back in Apple's order, NOT the requested order — so every
 *     result is keyed by its own `trackId` and never by position,
 *   • unknown ids are silently OMITTED rather than returned as errors, so the
 *     result set can be smaller than the request,
 *   • duplicate ids are echoed once per occurrence, so ids are deduped first.
 *
 * Measured-or-absent throughout: an app whose artwork Apple did not return is
 * left out of the set rather than carried with an empty url. A short set is the
 * honest outcome — `iconDistinctivenessFindings` has MIN_NEIGHBOURS for exactly
 * that and falls silent on its own.
 */
import { ITUNES_LOOKUP_URL } from "./constants.js";
import { asResponse, buildUrl, fetchJson, type FetchFn } from "./itunes.js";

/** One neighbour: its App Store id and the artwork url to read. */
export type NeighbourIcon = {
  appId: string;
  artworkUrl: string;
};

/**
 * How many chart neighbours to compare against. Ten is the window the finding
 * reasons about ("nine of the top ten"), and it stays inside the icon adapter's
 * MAX_ICONS_PER_RUN budget once your own icon is added.
 */
export const NEIGHBOUR_COUNT = 10;

/**
 * The top-N chart ids to compare against, excluding your own app.
 *
 * Pure. Your app is dropped wherever it sits in the chart, so a ranked app and an
 * unranked one both yield a set of NEIGHBOURS rather than a set that silently
 * includes yourself — comparing your icon against itself would bias the vote.
 * Ids are deduped: a feed that repeats an id would otherwise spend the Lookup
 * budget twice on one app.
 */
export function neighbourIdsFromChart(
  entries: string[],
  appId: string,
  count: number = NEIGHBOUR_COUNT,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([appId]);
  for (const id of entries) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= count) break;
  }
  return out;
}

/**
 * Pick the biggest artwork Apple returned for each result, keyed by trackId.
 *
 * Pure — takes the already-parsed Lookup results. Anything without both a
 * trackId and an artwork url is DROPPED: an app we cannot key or cannot read is
 * unmeasured, and carrying it with a blank url would put an unreadable entry
 * into a set whose whole purpose is to be measured.
 *
 * `requested` preserves YOUR ordering (Apple's response order differs), so the
 * neighbour set reads in chart order rather than whatever the CDN returned.
 */
export function neighbourIconsFromResults(
  results: unknown[],
  requested: string[],
): NeighbourIcon[] {
  const byId = new Map<string, string>();
  for (const raw of results) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as {
      trackId?: unknown;
      artworkUrl512?: unknown;
      artworkUrl100?: unknown;
      artworkUrl60?: unknown;
    };
    if (typeof r.trackId !== "number") continue;
    // Biggest first: the vision read wants the most detail available, and the
    // 512 is what Apple returns for essentially every current app.
    const art =
      typeof r.artworkUrl512 === "string"
        ? r.artworkUrl512
        : typeof r.artworkUrl100 === "string"
          ? r.artworkUrl100
          : typeof r.artworkUrl60 === "string"
            ? r.artworkUrl60
            : undefined;
    if (!art) continue;
    byId.set(String(r.trackId), art);
  }
  const out: NeighbourIcon[] = [];
  for (const id of requested) {
    const artworkUrl = byId.get(id);
    if (artworkUrl) out.push({ appId: id, artworkUrl });
  }
  return out;
}

/**
 * Fetch artwork urls for a set of App Store ids in ONE Lookup request.
 *
 * Never throws: a network or parse failure returns an empty set, which shrinks
 * the neighbour set and lets the finding fall silent — never a partial set
 * presented as complete.
 */
export async function fetchNeighbourIcons(
  fetchFn: FetchFn,
  appIds: string[],
  country = "us",
): Promise<NeighbourIcon[]> {
  const ids = [...new Set(appIds.filter((id) => id))];
  if (ids.length === 0) return [];
  try {
    const url = buildUrl(ITUNES_LOOKUP_URL, { id: ids.join(","), country });
    const data = await fetchJson(fetchFn, url);
    const results = asResponse(data).results ?? [];
    return neighbourIconsFromResults(results, ids);
  } catch {
    return [];
  }
}
