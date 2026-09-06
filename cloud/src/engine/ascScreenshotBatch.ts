/**
 * Screenshot upload lane (#374) — the whole strip, resolved from what an agent
 * actually has.
 *
 * `uploadScreenshot` moves ONE asset into a set id the caller already knows.
 * Knowing that id meant a person running `asc versions list`, `asc
 * localizations list`, and `asc screenshots list` by hand and pasting three
 * UUIDs into a curl — which is why the first live upload (2026-09-06) was made
 * by a person. This module does that resolution: bundle id → Apple app id →
 * the one editable version → the localization for the locale → the set for
 * the device bucket (found or created) → each shot in order.
 *
 * Honesty rules, each a test:
 *   - every refusal (placeholder name, empty file) happens BEFORE any request,
 *     so a bad strip publishes nothing rather than half of itself;
 *   - a shot already present in the set with the same name AND checksum is
 *     skipped, so an agent retry is idempotent and never duplicates;
 *   - a failure mid-strip stops the strip and the result says exactly which
 *     shots landed, which one failed, and which never started. No partial
 *     state is hidden behind a boolean;
 *   - only an EDITABLE version is ever touched (pickEditableVersion); a live
 *     READY_FOR_SALE listing cannot be reached from here;
 *   - nothing here submits. Uploading is not shipping.
 */
import { ascError, AscWriteError, findAscAppId, pickEditableVersion, pickLocalization, type FetchLike } from "./ascWrite.js";
import { ensureScreenshotSet } from "./ascScreenshotSet.js";
import { isPlaceholderAsset, md5Hex } from "./ascUpload.js";
import { uploadScreenshot } from "./ascUploadClient.js";

const ASC_BASE = "https://api.appstoreconnect.apple.com/v1";

export type BatchShot = { fileName: string; file: Uint8Array };

export type BatchInput = {
  token: string;
  bundleId: string;
  /** e.g. "en-US"; must exist on the editable version. */
  locale: string;
  /** Apple's device bucket, e.g. "APP_IPHONE_67". */
  displayType: string;
  shots: BatchShot[];
};

export type UploadedShot = { fileName: string; id: string; bytes: number; checksum: string; parts: number };
export type SkippedShot = { fileName: string; id: string; reason: "already present" };

export type BatchResult = {
  ok: boolean;
  appId: string;
  version: { id: string; versionString: string; state: string };
  localizationId: string;
  screenshotSetId: string;
  setCreated: boolean;
  uploaded: UploadedShot[];
  skipped: SkippedShot[];
  failed?: { fileName: string; reason: string };
  /** file names that were never attempted because an earlier one failed. */
  remaining: string[];
};

/** Everything that is wrong with a strip, found before a single request. */
export function preflightShots(shots: BatchShot[]): string[] {
  const problems: string[] = [];
  if (shots.length === 0) problems.push("no shots given");
  const seen = new Set<string>();
  for (const s of shots) {
    const name = s.fileName.trim();
    if (!name) problems.push("a shot has no fileName");
    else if (isPlaceholderAsset(name)) problems.push(`"${name}" is a renderer placeholder (needsReview), not a real captured screen`);
    else if (seen.has(name.toLowerCase())) problems.push(`"${name}" appears twice`);
    seen.add(name.toLowerCase());
    if (s.file.length === 0) problems.push(`"${name || "(unnamed)"}" is empty`);
  }
  return problems;
}

type ExistingShot = { id: string; fileName: string; checksum: string };

/** The shot in the set that makes this upload a no-op: same name, same bytes. */
export function alreadyPresent(existing: ExistingShot[], shot: BatchShot): ExistingShot | undefined {
  const name = shot.fileName.trim().toLowerCase();
  const sum = md5Hex(shot.file);
  return existing.find((e) => e.fileName.trim().toLowerCase() === name && e.checksum === sum);
}

export type BatchDeps = {
  findAscAppId: typeof findAscAppId;
  ensureScreenshotSet: typeof ensureScreenshotSet;
  uploadScreenshot: typeof uploadScreenshot;
};

const defaultDeps: BatchDeps = { findAscAppId, ensureScreenshotSet, uploadScreenshot };

export async function uploadScreenshotBatch(
  fetchFn: FetchLike,
  input: BatchInput,
  deps: BatchDeps = defaultDeps,
): Promise<BatchResult> {
  const problems = preflightShots(input.shots);
  if (problems.length) throw new AscWriteError(`refusing the strip: ${problems.join("; ")}`);

  const auth = { authorization: `Bearer ${input.token}` };
  const appId = await deps.findAscAppId(fetchFn, input.token, input.bundleId);

  const versionsRes = await fetchFn(`${ASC_BASE}/apps/${encodeURIComponent(appId)}/appStoreVersions?limit=50`, { headers: auth });
  if (!versionsRes.ok) throw await ascError(versionsRes, "list app store versions");
  const versions = (await versionsRes.json().catch(() => ({}))) as { data?: Parameters<typeof pickEditableVersion>[0] };
  const version = pickEditableVersion(versions.data ?? []);

  const locsRes = await fetchFn(`${ASC_BASE}/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`, { headers: auth });
  if (!locsRes.ok) throw await ascError(locsRes, "list version localizations");
  const locs = (await locsRes.json().catch(() => ({}))) as { data?: Parameters<typeof pickLocalization>[0] };
  const localization = pickLocalization(locs.data ?? [], input.locale);

  const set = await deps.ensureScreenshotSet(fetchFn, { token: input.token, localizationId: localization.id, displayType: input.displayType });

  const shotsRes = await fetchFn(`${ASC_BASE}/appScreenshotSets/${encodeURIComponent(set.id)}/appScreenshots?limit=50`, { headers: auth });
  if (!shotsRes.ok) throw await ascError(shotsRes, "list screenshots in the set");
  const listed = (await shotsRes.json().catch(() => ({}))) as {
    data?: { id?: string; attributes?: { fileName?: string; sourceFileChecksum?: string } }[];
  };
  const existing: ExistingShot[] = (listed.data ?? [])
    .filter((s) => typeof s.id === "string")
    .map((s) => ({ id: s.id as string, fileName: s.attributes?.fileName ?? "", checksum: s.attributes?.sourceFileChecksum ?? "" }));

  const result: BatchResult = {
    ok: true,
    appId,
    version: { id: version.id, versionString: version.attributes?.versionString ?? "", state: version.attributes?.appStoreState ?? "" },
    localizationId: localization.id,
    screenshotSetId: set.id,
    setCreated: set.created,
    uploaded: [],
    skipped: [],
    remaining: [],
  };

  for (const [i, shot] of input.shots.entries()) {
    const dup = alreadyPresent(existing, shot);
    if (dup) {
      result.skipped.push({ fileName: shot.fileName, id: dup.id, reason: "already present" });
      continue;
    }
    try {
      const up = await deps.uploadScreenshot(fetchFn, { token: input.token, screenshotSetId: set.id, fileName: shot.fileName, file: shot.file });
      result.uploaded.push({ fileName: up.fileName, id: up.id, bytes: up.bytes, checksum: up.checksum, parts: up.parts });
    } catch (e) {
      result.ok = false;
      result.failed = { fileName: shot.fileName, reason: e instanceof Error ? e.message : String(e) };
      result.remaining = input.shots.slice(i + 1).map((s) => s.fileName);
      return result;
    }
  }
  return result;
}
