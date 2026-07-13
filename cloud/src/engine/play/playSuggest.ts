/**
 * Play autocomplete / suggest — keyless keyword DISCOVERY (data-map §6.3). The
 * honest replacement for a search-volume table: real terms Play surfaces for a
 * seed, carrying ZERO volume (nothing to fabricate). Feeds keyword discovery and
 * gives the search-rank tracker (playSearchRank) real terms to measure.
 *
 * Transport is the internal `batchexecute` `IJ4APc` RPC (data-map §1), so — like
 * the chart source — it's BRITTLE (reverse-engineered) and DEGRADE-SAFE: any
 * failure → `[]`. We parse by CONTENT (plausible query strings out of the parsed
 * payload) rather than a fragile positional walk, and claim nothing but "Play
 * suggested these" — never a volume, never a ranking.
 */
import { USER_AGENT } from "../constants.js";
import { type Finding, mk } from "../findings/core.js";
import type { FetchLike } from "./googleAuth.js";

const BATCHEXECUTE_URL = "https://play.google.com/_/PlayStoreUi/data/batchexecute";
/** Real rpcid for the search-suggest call (data-map §1). */
const SUGGEST_RPCID = "IJ4APc";

/** The injected keyless suggest source: completion strings for a (term, country). */
export type PlaySuggestSource = (opts: {
  term: string;
  country: string;
  limit?: number;
}) => Promise<string[]>;

/** Build the batchexecute POST for a suggest query. */
export function buildSuggestRequest(opts: { term: string; country: string }): {
  url: string;
  body: string;
} {
  const url =
    `${BATCHEXECUTE_URL}?rpcids=${SUGGEST_RPCID}` +
    `&source-path=%2Fstore%2Fapps&gl=${encodeURIComponent(opts.country)}&hl=en`;
  // Inner payload carries the query text; the surrounding shape is the fixed
  // field-mask google-play-scraper uses for IJ4APc (5 = app-suggest context).
  const inner = JSON.stringify([[opts.term], [5], 5]);
  const freq = JSON.stringify([[[SUGGEST_RPCID, inner, null, "generic"]]]);
  return { url, body: `f.req=${encodeURIComponent(freq)}` };
}

/** batchexecute structural tokens that pass the word test but aren't suggestions. */
const STRUCTURAL_TOKENS = new Set([SUGGEST_RPCID.toLowerCase(), "generic", "wrb.fr"]);

/** A string that reads like a real search suggestion (not a token / url / id). */
function looksLikeSuggestion(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 60) return false;
  if (STRUCTURAL_TOKENS.has(t.toLowerCase())) return false; // rpc envelope tokens
  if (/^https?:\/\//i.test(t)) return false; // urls
  if (/^[a-z]+(\.[a-z0-9_]+)+$/i.test(t)) return false; // package ids
  if (/[<>{}[\]\\]/.test(t)) return false; // markup / json fragments
  if (!/[a-z]/i.test(t)) return false; // must contain letters
  // suggestions are words/phrases: letters, spaces, and light punctuation only.
  return /^[\p{L}\p{N} '&.+:-]+$/u.test(t);
}

/**
 * Extract suggestion strings from a batchexecute suggest response, by CONTENT.
 * Strips the anti-hijack prefix, deep-walks the parsed structure (recursing into
 * the JSON-encoded inner payload), and collects plausible query strings in order,
 * deduped and capped. Never throws; a shape it can't parse yields `[]`.
 */
export function parseSuggestResponse(body: string, limit = 10): string[] {
  const start = body.search(/[[{]/);
  if (start < 0) return [];
  let root: unknown;
  try {
    root = JSON.parse(body.slice(start));
  } catch {
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
      const s = v.trim();
      if (s.startsWith("[") || s.startsWith("{")) {
        try {
          walk(JSON.parse(s));
          return;
        } catch {
          /* not JSON — fall through */
        }
      }
      const key = s.toLowerCase();
      if (looksLikeSuggestion(s) && !seen.has(key)) {
        seen.add(key);
        out.push(s);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const el of v) {
        if (out.length >= limit) return;
        walk(el);
      }
    } else if (v && typeof v === "object") {
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
 * A context finding listing the terms Play autocompletes for a seed — DISCOVERY,
 * never a volume claim. Empty suggestions → nothing (honest silence, not a zero).
 */
export function playSuggestFinding(seed: string, suggestions: string[]): Finding[] {
  const terms = suggestions.filter(Boolean).slice(0, 10);
  if (terms.length === 0) return [];
  return [
    mk({
      id: "play_suggest_discovery",
      surface: "searchDiscovery",
      severity: "info",
      impact: "ranking",
      title: `Play autocompletes ${terms.length} related term${terms.length === 1 ? "" : "s"} for "${seed}"`,
      detail:
        "Real terms Google Play surfaces in autocomplete for this seed — discovery candidates to target and track. Play publishes no search volume, so these carry demand as direction, not a number.",
      fix: "",
      evidence: terms.join(", "),
      context: true,
    }),
  ];
}

/**
 * A `PlaySuggestSource` over Play's batchexecute. Degrade-safe: any non-OK
 * status / parse failure / network error → `[]`.
 */
export function playSuggestSource(fetchLike: FetchLike): PlaySuggestSource {
  return async ({ term, country, limit = 10 }) => {
    const q = term.trim();
    if (!q) return [];
    try {
      const { url, body } = buildSuggestRequest({ term: q, country });
      const resp = await fetchLike(url, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body,
      });
      if (!resp.ok) return [];
      return parseSuggestResponse(await resp.text(), limit);
    } catch {
      return [];
    }
  };
}
