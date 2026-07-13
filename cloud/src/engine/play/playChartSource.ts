/**
 * The concrete keyless Play chart source — the BRITTLE half behind the injected
 * `PlayChartSource` seam. Play has no official top-charts JSON; the only keyless
 * route is the internal `batchexecute` `vyAe2` RPC (data-map §1). We POST it and
 * parse the ordered package ids out of the response.
 *
 * ⚠️ Two brittleness facts, handled honestly:
 *   • the `f.req` field-mask is a reverse-engineered, drift-prone constant (per
 *     google-play-scraper); Google can change the jspb schema anytime.
 *   • datacenter/Worker egress gets 429'd/blocked (data-map §1).
 * So this is DEGRADE-SAFE by construction: any failure → `[]`, which the pure
 * engine reads as UNKNOWN (`null`), never a fabricated rank. And we parse by
 * CONTENT (package-id pattern) rather than fragile positional array paths, so it
 * survives nesting drift better than a hard-coded `ds:`/index walk.
 */
import { USER_AGENT } from "../constants.js";
import type { FetchLike } from "./googleAuth.js";
import type { PlayChartCollection, PlayChartSource } from "./playChartRank.js";

const BATCHEXECUTE_URL = "https://play.google.com/_/PlayStoreUi/data/batchexecute";
/** Real rpcid for the top-charts `list` call (data-map §1; the query-string one is stale). */
const LIST_RPCID = "vyAe2";

/** UI collection → Play server value (google-play-scraper CLUSTER_NAMES). */
const COLLECTION_SERVER: Record<PlayChartCollection, string> = {
  TOP_FREE: "topselling_free",
  TOP_PAID: "topselling_paid",
  GROSSING: "topgrossing",
};

/** A reverse-DNS package id, e.g. com.foo.bar (≥ 2 dot-separated segments). */
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i;

/** Build the batchexecute POST for a (collection, category, country). */
export function buildChartRequest(opts: {
  collection: PlayChartCollection;
  category: string;
  country: string;
}): { url: string; body: string } {
  const url =
    `${BATCHEXECUTE_URL}?rpcids=${LIST_RPCID}` +
    `&source-path=%2Fstore%2Fapps&gl=${encodeURIComponent(opts.country)}&hl=en`;
  // The inner payload ends in [2,"<collection>","<category>"] — the only parts that
  // vary. The rest is the fixed field-mask google-play-scraper carries for vyAe2.
  const inner = JSON.stringify([null, null, [2, COLLECTION_SERVER[opts.collection], opts.category]]);
  const freq = JSON.stringify([[[LIST_RPCID, inner, null, "generic"]]]);
  const body = `f.req=${encodeURIComponent(freq)}`;
  return { url, body };
}

/**
 * Extract ordered package ids from a batchexecute response, by CONTENT. Strips
 * the anti-JSON-hijack prefix, deep-walks the parsed structure collecting strings
 * that look like package ids (in order, deduped), and caps at `limit`. Never
 * throws; a shape it can't parse yields `[]`.
 */
export function parsePlayChartResponse(body: string, limit = 100): string[] {
  // Responses are prefixed with `)]}'` and/or a length line; find the first JSON.
  const start = body.search(/[[{]/);
  if (start < 0) return [];
  let root: unknown;
  try {
    root = JSON.parse(body.slice(start));
  } catch {
    // The outer envelope may be line-wrapped; try the largest JSON array line.
    const line = body.split("\n").find((l) => l.trim().startsWith("[["));
    if (!line) return [];
    try {
      root = JSON.parse(line);
    } catch {
      return [];
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown): void => {
    if (out.length >= limit) return;
    if (typeof v === "string") {
      // batchexecute wraps the rpc RESULT as a JSON-encoded string inside the
      // outer envelope — recurse into it so the package ids nested there are seen.
      const s = v.trim();
      if (s.startsWith("[") || s.startsWith("{")) {
        try {
          walk(JSON.parse(s));
          return;
        } catch {
          /* not JSON — fall through to the package-id test */
        }
      }
      if (PACKAGE_RE.test(v) && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const el of v) {
        if (out.length >= limit) return;
        walk(el);
      }
    }
    // objects: batchexecute payloads are arrays-of-arrays, but be defensive.
    else if (v && typeof v === "object") {
      for (const el of Object.values(v)) {
        if (out.length >= limit) return;
        walk(el);
      }
    }
  };
  walk(root);
  return out.slice(0, limit);
}

/**
 * A `PlayChartSource` backed by a raw `FetchFn` hitting Play's batchexecute.
 * Degrade-safe: any non-OK status / parse failure / network error → `[]`.
 */
export function playChartSource(fetchLike: FetchLike): PlayChartSource {
  return async ({ collection, category, country, limit = 100 }) => {
    try {
      const { url, body } = buildChartRequest({ collection, category, country });
      const resp = await fetchLike(url, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body,
      });
      if (!resp.ok) return [];
      return parsePlayChartResponse(await resp.text(), limit);
    } catch {
      return [];
    }
  };
}
