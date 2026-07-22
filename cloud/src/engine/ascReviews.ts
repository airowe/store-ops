/**
 * Authenticated App Store Connect Customer Reviews ingest.
 *
 * Reads the full `customerReviews` corpus (keyed by a STABLE ascReviewId that the
 * public RSS feed lacks) and normalizes it to `AscReview` — a SUPERSET of the RSS
 * `Review` type, so it feeds reviewSentiment.ts unchanged. Pure + fetch-injected
 * like ascRead.ts / ascWrite.ts; honest states, never throws into the audit.
 *
 * The `.p8` never reaches this module — only the short-lived JWT.
 */

import { ASC_BASE, type FetchLike } from "./ascWrite.js";

/** A single authenticated ASC review. Superset of reviewSentiment.ts `Review`. */
export type AscReview = {
  id: string; // dedup/identity key for reviewSentiment `Review` compatibility (NOT the response target)
  author: string;
  rating: number | null;
  title: string;
  content: string;
  version: string;
  country: string;
  ascReviewId: string; // stable ASC id — the response target
  createdDate: string;
  responseState: "none" | "published";
  existingResponseId?: string | undefined;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function coerceRating(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Map one ASC `customerReviews` data row to an AscReview, or null if malformed. */
export function mapAscReview(raw: unknown): AscReview | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  const attrs = (o.attributes ?? {}) as Record<string, unknown>;
  const content = str(attrs.body);
  if (!id || !content.trim()) return null;

  const rels = (o.relationships ?? {}) as Record<string, unknown>;
  const respData = ((rels.response as Record<string, unknown>)?.data ?? null) as
    | { id?: unknown }
    | null;
  const existingResponseId = respData && str(respData.id) ? str(respData.id) : undefined;

  return {
    id,
    ascReviewId: id,
    author: str(attrs.reviewerNickname),
    rating: coerceRating(attrs.rating),
    title: str(attrs.title),
    content,
    version: str(attrs.appVersionString),
    country: str(attrs.territory).toLowerCase(),
    createdDate: str(attrs.createdDate),
    responseState: existingResponseId ? "published" : "none",
    existingResponseId,
  };
}

export type AscReviewsResult =
  | { state: "ok"; reviews: AscReview[] }
  | { state: "permission_required" }
  | { state: "unavailable" };

const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_REVIEWS = 500;

/**
 * READ-ONLY authenticated corpus fetch. Bounded cursor paging. Honest states:
 * 401/403 → permission_required (role gap); any other non-OK or thrown error →
 * unavailable. NEVER throws — a read limitation must not fail or slow the audit.
 */
export async function fetchAscReviews(
  fetchFn: FetchLike,
  opts: { token: string; appId: string; maxPages?: number; maxReviews?: number },
): Promise<AscReviewsResult> {
  const maxPages = Math.max(1, opts.maxPages ?? DEFAULT_MAX_PAGES);
  const maxReviews = Math.max(1, opts.maxReviews ?? DEFAULT_MAX_REVIEWS);
  const auth = { authorization: `Bearer ${opts.token}` };
  const reviews: AscReview[] = [];

  let url: string | null =
    `${ASC_BASE}/apps/${encodeURIComponent(opts.appId)}/customerReviews` +
    `?include=response&limit=200&sort=-createdDate`;

  for (let page = 0; page < maxPages && url; page++) {
    let res: Response;
    try {
      res = await fetchFn(url, { headers: auth });
    } catch {
      return { state: "unavailable" };
    }
    if (!res.ok) {
      return res.status === 401 || res.status === 403
        ? { state: "permission_required" }
        : { state: "unavailable" };
    }
    const body = (await res.json().catch(() => ({}))) as {
      data?: unknown[];
      links?: { next?: string };
    };
    for (const row of body.data ?? []) {
      const mapped = mapAscReview(row);
      if (mapped) reviews.push(mapped);
      if (reviews.length >= maxReviews) return { state: "ok", reviews };
    }
    url = body.links?.next ?? null;
  }
  return { state: "ok", reviews };
}
