/**
 * Approve→push publish of a developer response to a customer review.
 *
 * Create-vs-update from existingResponseId: none → POST, present → PATCH
 * (idempotent edit). dryRun runs every lookup and returns the EXACT body without
 * writing (identical posture to applyAscMetadata). Validates length before send so
 * a rejected write can't happen. Throws AscWriteError (token-free) on failure.
 *
 * The `.p8` never reaches this module — only the short-lived JWT.
 */
import { ASC_BASE, AscWriteError, ascError, type FetchLike } from "./ascWrite.js";

/** Apple's developer-response max length. The single source of truth for the cap. */
export const APP_STORE_RESPONSE_MAX = 5970;

export type PublishResult = {
  ok: true;
  ascReviewId: string;
  responseId: string;
  mode: "created" | "updated";
  dryRun?: true;
  body?: unknown;
};

/** Pure body builder for a customerReviewResponses create/update. */
export function buildResponseBody(ascReviewId: string, text: string): unknown {
  return {
    data: {
      type: "customerReviewResponses",
      attributes: { responseBody: text },
      relationships: { review: { data: { type: "customerReviews", id: ascReviewId } } },
    },
  };
}

export async function publishResponse(
  fetchFn: FetchLike,
  opts: { token: string; ascReviewId: string; text: string; existingResponseId?: string; dryRun?: boolean },
): Promise<PublishResult> {
  const text = opts.text.trim();
  if (!text) throw new AscWriteError("Nothing to publish — the response text is empty.");
  if (text.length > APP_STORE_RESPONSE_MAX) {
    throw new AscWriteError(
      `Response is too long (${text.length} chars). Apple's limit is ${APP_STORE_RESPONSE_MAX}.`,
    );
  }

  const mode: "created" | "updated" = opts.existingResponseId ? "updated" : "created";
  const body = buildResponseBody(opts.ascReviewId, text);

  if (opts.dryRun) {
    return { ok: true, ascReviewId: opts.ascReviewId, responseId: opts.existingResponseId ?? "", mode, dryRun: true, body };
  }

  const auth = { authorization: `Bearer ${opts.token}`, "content-type": "application/json" };
  const url = opts.existingResponseId
    ? `${ASC_BASE}/customerReviewResponses/${encodeURIComponent(opts.existingResponseId)}`
    : `${ASC_BASE}/customerReviewResponses`;
  const method = opts.existingResponseId ? "PATCH" : "POST";

  // For PATCH, Apple wants the id inside data; add it without mutating the shared body.
  const sendBody = opts.existingResponseId
    ? { data: { ...(body as any).data, id: opts.existingResponseId } }
    : body;

  const res = await fetchFn(url, { method, headers: auth, body: JSON.stringify(sendBody) });
  if (!res.ok) throw await ascError(res, "publish the review response");

  const parsed = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
  const responseId = parsed.data?.id ?? opts.existingResponseId ?? "";
  return { ok: true, ascReviewId: opts.ascReviewId, responseId, mode };
}
