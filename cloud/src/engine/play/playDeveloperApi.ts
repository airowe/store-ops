/**
 * Google Play Developer API (Android Publisher v3) — the CONNECTED, owner-only
 * read tier. The reachable, sanctioned "api way": unlike scraping play.google.com
 * (ToS-risky + egress-blocked) or a third-party vendor (egress-blocked), this is
 * the official API, reachable from the Worker egress, and it reads the OWNER's
 * own listing at full fidelity — including the short description, which the public
 * scrape can't see.
 *
 * READ-ONLY POSTURE (constraint #2): the listings resource is only readable inside
 * an "edit". We INSERT an edit, LIST the listings, then DELETE the edit — we NEVER
 * call `commit`, so nothing is ever published. The transport is injected and given
 * no commit verb, so this path structurally cannot push to a live store.
 *
 * Pure logic + an injected transport, so it unit-tests with a fake (no network,
 * no credentials). The concrete transport (bearer token + fetch) is wired in the
 * API layer, mirroring how the App Store Connect reader is wired.
 */
import { type AppCandidate, type ResolveResult, classifyQuery } from "../resolveApp.js";
import { GOOGLE_PLAY_PROFILE } from "../store/profiles.js";
import type { NormalizedListing, StoreAdapter } from "../store/types.js";

const API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const DEFAULT_LANGUAGE = "en-US";

export class PlayApiError extends Error {}

/**
 * The injected HTTP transport for the Developer API. The API layer supplies one
 * that attaches the `Authorization: Bearer <token>` header (scope
 * `androidpublisher`) and performs the request. Deliberately exposes only the
 * verbs this read path needs — there is no `commit`, so it can't publish.
 */
export type PlayApiTransport = (req: {
  method: "GET" | "POST" | "DELETE";
  url: string;
}) => Promise<{ status: number; body: string }>;

/** One Android Publisher listing (the fields we read). */
export type PlayApiListing = {
  language?: string;
  title?: string;
  shortDescription?: string;
  fullDescription?: string;
  video?: string;
};

/** A trimmed non-empty string, else null (so "" reads as absent, never measured-empty). */
function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Map an Android Publisher listing → the store-agnostic NormalizedListing.
 * CONNECTED tier, so `reliable: true` (this is the owner's real data, not a public
 * scrape). The short description (`tagline`) is now READABLE — the key fidelity
 * win over the scrape path. `keywordField` stays null: Play has no keyword field.
 */
export function mapPlayApiListing(
  packageName: string,
  listing: PlayApiListing | undefined,
): NormalizedListing {
  return {
    store: "googleplay",
    appId: packageName,
    title: str(listing?.title),
    tagline: str(listing?.shortDescription),
    keywordField: null,
    longDescription: str(listing?.fullDescription),
    // Listing images come from a separate `images` resource (deferred); a
    // connected run with no images read carries an empty set, honestly.
    screenshots: [],
    // Category is not part of the listings resource; left null here.
    category: null,
    reliable: true,
  };
}

/** Pick the requested language's listing, else the first available. */
export function selectListing(
  listings: PlayApiListing[],
  language: string,
): PlayApiListing | undefined {
  return listings.find((l) => l.language === language) ?? listings[0];
}

/**
 * Read one owner-owned Play listing via the Developer API. Inserts an edit, lists
 * the listings, and ALWAYS deletes the edit (never commits → never publishes).
 * Throws `PlayApiError` on an API failure. The edit-delete is best-effort in a
 * `finally` so a read failure can't leak a dangling edit.
 */
export async function readPlayListingViaApi(
  transport: PlayApiTransport,
  packageName: string,
  opts: { language?: string; baseUrl?: string } = {},
): Promise<NormalizedListing> {
  const base = opts.baseUrl ?? API_BASE;
  const language = opts.language ?? DEFAULT_LANGUAGE;
  const appsBase = `${base}/applications/${encodeURIComponent(packageName)}`;

  // 1. Open a (throwaway) edit — listings are only readable within one.
  const inserted = await transport({ method: "POST", url: `${appsBase}/edits` });
  if (inserted.status < 200 || inserted.status >= 300) {
    throw new PlayApiError(`edits.insert failed: HTTP ${inserted.status}`);
  }
  const editId = (parse(inserted.body) as { id?: string } | null)?.id;
  if (!editId) throw new PlayApiError("edits.insert returned no edit id");

  try {
    // 2. Read the listings within the edit.
    const res = await transport({
      method: "GET",
      url: `${appsBase}/edits/${encodeURIComponent(editId)}/listings`,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new PlayApiError(`edits.listings.list failed: HTTP ${res.status}`);
    }
    const data = parse(res.body) as { listings?: PlayApiListing[] } | null;
    const listings = Array.isArray(data?.listings) ? data!.listings : [];
    return mapPlayApiListing(packageName, selectListing(listings, language));
  } finally {
    // 3. Discard the edit — NEVER commit. Best-effort; a failure here is non-fatal.
    try {
      await transport({
        method: "DELETE",
        url: `${appsBase}/edits/${encodeURIComponent(editId)}`,
      });
    } catch {
      // dangling edits expire on their own; never fail the read over cleanup.
    }
  }
}

/**
 * A `StoreAdapter` for the connected (owner) Play tier, backed by the Developer
 * API transport. Plugs into the same `auditPlayListing` loop as the public
 * adapter — but `reliable: true`, so an empty surface reads as a real absence
 * (not "?"/locked) and the short description is actually present. Resolution is
 * trivial (the owner names their own package); a free-text name is not-found.
 */
export function playDeveloperApiAdapter(
  transport: PlayApiTransport,
  opts: { language?: string } = {},
): StoreAdapter {
  const language = opts.language ?? DEFAULT_LANGUAGE;
  return {
    profile: GOOGLE_PLAY_PROFILE,
    resolve: async (query): Promise<ResolveResult> => {
      const q = classifyQuery(query);
      if (q.kind === "bundle-id") {
        const candidate: AppCandidate = {
          bundleId: q.id,
          name: q.id,
          publisher: null,
          genres: [],
          trackId: null,
          iconUrl: null,
        };
        return { kind: "resolved", query: q, candidates: [candidate], offset: 0, hasMore: false };
      }
      return { kind: "not-found", query: q, candidates: [], offset: 0, hasMore: false };
    },
    readListing: (appId) => readPlayListingViaApi(transport, appId, { language }),
  };
}
