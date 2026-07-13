/**
 * Google Play "Data safety" — the WRITE half (owner-only). The first Play
 * fix-and-push in the product, and it targets a LEGAL DECLARATION, so the whole
 * design is built around one rule: **we never author the declaration; the human
 * does.** We validate and push the owner's own `safetyLabels` CSV verbatim.
 *
 *   • The write API is `POST androidpublisher/v3/applications/{pkg}/dataSafety`
 *     with a `SafetyLabelsUpdateRequest { safetyLabels: <CSV string> }` (data-map
 *     §3.1, rev-20260706). It REPLACES the whole declaration, so a wrong CSV is a
 *     wrong legal statement — hence validate + human-approve, never auto-generate.
 *   • Structurally separate transport from the read path (`PlayApiTransport` has
 *     no body): this `PlayWriteTransport` carries the JSON body, and is only ever
 *     minted behind the gated, approval-bound route.
 *
 * Pure validation + an injected transport → unit-tests with a fake, no network.
 */
import { PlayApiError } from "./playDeveloperApi.js";

const API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";

/** Injected write transport: an authorized POST with a JSON body. The route
 *  mints one that attaches `Authorization: Bearer <token>` (androidpublisher). */
export type PlayWriteTransport = (req: {
  url: string;
  body: string;
}) => Promise<{ status: number; body: string }>;

export type CsvValidation = { ok: true } | { ok: false; error: string };

/**
 * Validate a Data-safety `safetyLabels` CSV before we ever push it. Deliberately
 * SHAPE-only (non-empty, header row present, comma-structured, sane size) — we do
 * NOT try to judge the declaration's content, because the human owns that. The
 * point is to reject an obviously-malformed blob, not to certify correctness.
 */
export function validateSafetyLabelsCsv(csv: string): CsvValidation {
  const text = (csv ?? "").trim();
  if (text === "") return { ok: false, error: "The declaration CSV is empty." };
  if (text.length > 200_000) return { ok: false, error: "The declaration CSV is implausibly large." };
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    return { ok: false, error: "Expected a header row and at least one data row." };
  }
  const header = lines[0] ?? "";
  if (!header.includes(",")) {
    return { ok: false, error: "The header row is not comma-separated — is this the Play data-safety CSV?" };
  }
  return { ok: true };
}

/** Build the `SafetyLabelsUpdateRequest` body from a (already-validated) CSV. */
export function buildSafetyLabelsRequest(csv: string): { safetyLabels: string } {
  return { safetyLabels: csv };
}

export type PlayDataSafetyWriteResult = {
  packageName: string;
  pushed: true;
};

/**
 * Push the owner's Data-safety declaration CSV via the injected write transport.
 * Validates first (throws `PlayApiError` on a malformed CSV — nothing is sent),
 * then POSTs the `SafetyLabelsUpdateRequest`. A non-2xx status throws with the
 * HTTP status only (key-free). Owner-only + approval-bound by the caller.
 */
export async function writeDataSafetyLabels(
  transport: PlayWriteTransport,
  packageName: string,
  csv: string,
  opts: { baseUrl?: string } = {},
): Promise<PlayDataSafetyWriteResult> {
  const pkg = packageName?.trim();
  if (!pkg) throw new PlayApiError("packageName is required");
  const check = validateSafetyLabelsCsv(csv);
  if (!check.ok) throw new PlayApiError(check.error);

  const base = opts.baseUrl ?? API_BASE;
  const url = `${base}/applications/${encodeURIComponent(pkg)}/dataSafety`;
  const resp = await transport({ url, body: JSON.stringify(buildSafetyLabelsRequest(csv)) });
  if (resp.status < 200 || resp.status >= 300) {
    throw new PlayApiError(`dataSafety write failed: HTTP ${resp.status}`);
  }
  return { packageName: pkg, pushed: true };
}
