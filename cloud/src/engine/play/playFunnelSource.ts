/**
 * Google Play funnel — the FETCH half. Reads the monthly store-performance CSV
 * from the developer's private GCS export bucket `gs://pubsite_prod_rev_<id>/`
 * (data-map §3.3) via the Cloud Storage JSON API, using an owner-minted token
 * (scope `devstorage.read_only`). The report object path is Google's, so the
 * exact object name is best-effort — hence the whole path is GATED and this
 * fetch is DEGRADE-SAFE: any failure → `null`, and the caller leaves prior data
 * intact (never a fabricated series).
 *
 * The token mint + fetch are injected (a `FetchLike`), so this unit-tests with a
 * fake — no GCS, no credentials.
 */
import type { FetchLike } from "./googleAuth.js";
import { type PlayFunnelRow, parsePlayFunnelCsv } from "./playFunnelParse.js";

const GCS_BASE = "https://storage.googleapis.com/storage/v1/b";
export const DEVSTORAGE_READONLY_SCOPE = "https://www.googleapis.com/auth/devstorage.read_only";

/** The private export bucket for a developer account id. */
export function pubsiteBucket(accountId: string): string {
  return `pubsite_prod_rev_${accountId}`;
}

/**
 * The store-performance object name for a package + month (YYYYMM). Google names
 * these `stats/store_performance/store_performance_<pkg>_<YYYYMM>_country.csv`.
 * Best-effort (Google owns the naming), which is why the path is gated.
 */
export function storePerformanceObject(packageName: string, yyyymm: string): string {
  return `stats/store_performance/store_performance_${packageName}_${yyyymm}_country.csv`;
}

/** Build the GCS media-download URL for an object in a bucket. */
export function gcsObjectUrl(bucket: string, object: string): string {
  return `${GCS_BASE}/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
}

/**
 * Fetch + parse one month's Play store-performance CSV from the export bucket.
 * Degrade-safe: a non-2xx (object not there yet / no access) or any error → null
 * (UNKNOWN — the caller keeps prior data), never throws, never a fabricated row.
 */
export async function fetchPlayFunnelMonth(
  fetchLike: FetchLike,
  opts: { accessToken: string; accountId: string; packageName: string; yyyymm: string },
): Promise<PlayFunnelRow[] | null> {
  const url = gcsObjectUrl(pubsiteBucket(opts.accountId), storePerformanceObject(opts.packageName, opts.yyyymm));
  try {
    const resp = await fetchLike(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    });
    if (!resp.ok) return null;
    return parsePlayFunnelCsv(await resp.text());
  } catch {
    return null;
  }
}
