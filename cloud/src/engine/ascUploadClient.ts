/**
 * App Store Connect asset upload — the I/O half (#374).
 *
 * Walks Apple's three-step reservation with an injected fetch:
 *   1. POST  /appScreenshots        declare fileSize + fileName → uploadOperations
 *   2. PUT   each operation         exactly the slices Apple asked for
 *   3. PATCH /appScreenshots/{id}   { uploaded: true, sourceFileChecksum }
 *
 * ORDER IS LOAD-BEARING. Step 3 tells Apple "this asset is complete and ready to
 * show". Reaching it after a failed part would publish a corrupt image to a live
 * listing, so any failure aborts BEFORE the commit — the reservation is left
 * uncommitted (Apple garbage-collects it) rather than finished with bad bytes.
 *
 * The pure parts — checksum, slice plan, placeholder refusal — live in
 * ascUpload.ts and are validated before the first request goes out.
 */
import { ascError, type FetchLike } from "./ascWrite.js";
import { isPlaceholderAsset, md5Hex, planUploadParts, type UploadOperation } from "./ascUpload.js";

const ASC_BASE = "https://api.appstoreconnect.apple.com/v1";

export type UploadScreenshotInput = {
  /** Short-lived ASC bearer token (never persisted; see credentialVault). */
  token: string;
  /** The appScreenshotSet this asset belongs to (device size × localization). */
  screenshotSetId: string;
  fileName: string;
  file: Uint8Array;
};

export type UploadScreenshotResult = {
  ok: true;
  id: string;
  fileName: string;
  bytes: number;
  checksum: string;
};

type ReservationResponse = {
  data?: { id?: string; attributes?: { uploadOperations?: UploadOperation[] } };
};

/**
 * Upload one screenshot into an existing appScreenshotSet.
 *
 * Throws on ANY failure — the caller must treat a throw as "nothing was
 * published", which holds because the commit is last.
 */
export async function uploadScreenshot(
  fetchFn: FetchLike,
  input: UploadScreenshotInput,
): Promise<UploadScreenshotResult> {
  // ── refusals, BEFORE anything is created at Apple ──────────────────────────
  // A placeholder on a live listing is a fabricated asset. Refused hard, and
  // refused here so no reservation is even opened for it.
  if (isPlaceholderAsset(input.fileName)) {
    throw new Error(
      `refusing to upload "${input.fileName}": it is a renderer placeholder (needsReview), not a real captured screen`,
    );
  }
  if (input.file.length === 0) {
    throw new Error(`refusing to upload "${input.fileName}": the file is empty`);
  }

  const auth = { authorization: `Bearer ${input.token}` };

  // ── 1. reserve ────────────────────────────────────────────────────────────
  const reserveRes = await fetchFn(`${ASC_BASE}/appScreenshots`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      data: {
        type: "appScreenshots",
        attributes: { fileSize: input.file.length, fileName: input.fileName },
        relationships: {
          appScreenshotSet: { data: { type: "appScreenshotSets", id: input.screenshotSetId } },
        },
      },
    }),
  });
  if (!reserveRes.ok) throw await ascError(reserveRes, "reserve screenshot upload");

  const reserved = (await reserveRes.json().catch(() => ({}))) as ReservationResponse;
  const id = reserved.data?.id;
  const ops = reserved.data?.attributes?.uploadOperations ?? [];
  if (!id) throw new Error("App Store Connect returned no screenshot id for the reservation");

  // Validated BEFORE transferring: a plan that does not cover the file exactly
  // yields a corrupt asset Apple only rejects at commit, i.e. after every byte
  // has already crossed the wire.
  const parts = planUploadParts(input.file, ops);

  // ── 2. transfer ───────────────────────────────────────────────────────────
  for (const [i, part] of parts.entries()) {
    // Deliberately NO authorization header: these URLs are pre-signed by Apple,
    // and forwarding the bearer token would hand our credential to a host that
    // does not need it.
    const putRes = await fetchFn(part.url, {
      method: part.method,
      headers: part.headers,
      body: part.body as unknown as BodyInit,
    });
    if (!putRes.ok) {
      throw await ascError(putRes, `upload part ${i + 1} of ${parts.length}`);
    }
  }

  // ── 3. commit ─────────────────────────────────────────────────────────────
  // Only now does Apple consider the asset complete. Checksum is of the bytes we
  // actually sent, so a mismatch here means the transfer corrupted them.
  const checksum = md5Hex(input.file);
  const commitRes = await fetchFn(`${ASC_BASE}/appScreenshots/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      data: {
        type: "appScreenshots",
        id,
        attributes: { uploaded: true, sourceFileChecksum: checksum },
      },
    }),
  });
  if (!commitRes.ok) throw await ascError(commitRes, "commit screenshot upload");

  return { ok: true, id, fileName: input.fileName, bytes: input.file.length, checksum };
}
