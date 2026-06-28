/**
 * Google Play `StoreAdapter` — drives our own Play data provider behind the same
 * store-agnostic interface the App Store adapter uses, so one orchestrator can
 * audit either store.
 *
 * Resolution scope (honest): a package id or a `play.google.com/...?id=` URL
 * resolves directly (we read the listing to fill the candidate's name). A plain
 * NAME query returns `not-found` — Play's search results live in the
 * undocumented `ds:` blobs we don't parse, so we DON'T fake a name search.
 */
import { type AppCandidate, type ResolveResult, classifyQuery } from "../resolveApp.js";
import { GOOGLE_PLAY_PROFILE } from "../store/profiles.js";
import type { StoreAdapter } from "../store/types.js";
import { readPlayListing } from "./readPlayListing.js";
import type { PlayPageSource } from "./playWebSource.js";

/** A `StoreAdapter` for Google Play, backed by an injected `PlayPageSource`. */
export function playAdapter(source: PlayPageSource): StoreAdapter {
  return {
    profile: GOOGLE_PLAY_PROFILE,
    resolve: async (query, opts): Promise<ResolveResult> => {
      const q = classifyQuery(query);
      // A dotted package id or a Play URL classifies as "bundle-id" — resolvable.
      if (q.kind === "bundle-id") {
        const listing = await readPlayListing(source, q.id, opts);
        const candidate: AppCandidate = {
          bundleId: q.id,
          name: listing.title ?? q.id,
          publisher: null,
          genres: listing.category ? [listing.category.name ?? listing.category.id] : [],
          trackId: null,
          iconUrl: null,
        };
        return { kind: "resolved", query: q, candidates: [candidate], offset: 0, hasMore: false };
      }
      // A numeric App Store id or a plain name: not a resolvable Play package here.
      // Name search is deferred (Play search data is undocumented ds: blobs — not faked).
      return { kind: "not-found", query: q, candidates: [], offset: 0, hasMore: false };
    },
    readListing: (appId, opts) => readPlayListing(source, appId, opts),
  };
}
