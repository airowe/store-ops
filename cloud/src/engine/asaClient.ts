/**
 * Apple Search Ads (ASA) API v5 reader — Apple's OWN keyword search popularity
 * for a connected user's own terms (#78 item 2, Phase 2). This is the ONE
 * real-data signal a pure data tool has that we honestly don't fabricate (#65):
 * `rankOpportunity` deliberately omits "search volume/difficulty" because we had
 * no measured source. A user's authorized ASA account IS a measured source — so
 * this reader surfaces a REAL popularity index, and ONLY when Apple actually
 * returns one. Absent/failed → an empty map; the scoring path falls back to the
 * measured-rank-only signals, unchanged. It NEVER fabricates a number.
 *
 * ⚠️ LIVE-VERIFICATION GATE: the exact v5 popularity endpoint + response shape
 * below are Apple's documented shape but have NOT been exercised against a live
 * ASA account in this environment (a funded ASA account is an owner action, per
 * the #78-2 spike). Until verified in prod, this reader stays UNWIRED from
 * user-facing scoring (see Phase 3 — it's gated + labeled, like CRED_KEK_V1).
 * The parser is deliberately tolerant + degrade-safe so a shape surprise yields
 * "no popularity", never a wrong or fabricated one.
 */
import { ASA_API_BASE, type FetchLike } from "./asaAuth.js";

/** A real ASA popularity reading for one term. `popularity` is Apple's 5–100
 *  relative index; `source` marks it as measured-from-ASA so the UI/scoring can
 *  label it distinctly from our derived proxies (never blend silently). */
export type AsaPopularity = {
  keyword: string;
  popularity: number; // Apple's search-popularity index (nominally 5–100)
  source: "asa";
};

/**
 * Read Apple's search popularity for `terms` against the connected `orgId`.
 * Returns a map keyed by the lower-cased term → reading, containing ONLY terms
 * Apple returned a valid popularity for. On any failure (non-2xx, non-JSON,
 * unexpected shape, empty input) it returns an empty map — degrade, never throw
 * into the scoring path, never fabricate.
 */
export async function keywordPopularity(
  fetchLike: FetchLike,
  args: { accessToken: string; orgId: string; terms: string[] },
): Promise<Map<string, AsaPopularity>> {
  const out = new Map<string, AsaPopularity>();
  const terms = dedupeNonEmpty(args.terms);
  if (terms.length === 0) return out;

  let resp: Awaited<ReturnType<FetchLike>>;
  try {
    resp = await fetchLike(`${ASA_API_BASE}/keywords/searchpopularity`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": "application/json",
        // ASA scopes every call to an org via this context header.
        "X-AP-Context": `orgId=${args.orgId}`,
      },
      body: JSON.stringify({ keywords: terms }),
    });
  } catch {
    return out; // transport failure → no popularity, honest fallback
  }
  if (resp.status < 200 || resp.status >= 300) return out;

  let payload: unknown;
  try {
    payload = JSON.parse(await resp.text());
  } catch {
    return out;
  }

  // Tolerant extraction: accept the documented `{ data: [ ... ] }` envelope and
  // a bare array; accept keyword under `keyword`/`text`/`searchTerm` and the
  // score under `searchPopularity`/`popularity`/`score`. Anything we can't read
  // cleanly is dropped (not guessed).
  for (const row of asRows(payload)) {
    const keyword = firstString(row, ["keyword", "text", "searchTerm"]);
    const score = firstNumber(row, ["searchPopularity", "popularity", "score"]);
    if (keyword === null || score === null) continue;
    const key = keyword.trim().toLowerCase();
    if (key === "" || !Number.isFinite(score)) continue;
    out.set(key, { keyword: keyword.trim(), popularity: score, source: "asa" });
  }
  return out;
}

function dedupeNonEmpty(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const v = (t ?? "").trim();
    if (v === "") continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function asRows(payload: unknown): Array<Record<string, unknown>> {
  const arr = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? (payload as { data: unknown[] }).data
      : [];
  return arr.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
}

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}
