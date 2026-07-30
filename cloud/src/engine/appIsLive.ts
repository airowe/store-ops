/**
 * Is this app actually IN the App Store?
 *
 * Measured on the owner's account: 13 connected apps, 7 live. The other six had
 * never shipped — four in PREPARE_FOR_SUBMISSION, two REJECTED at 1.0/0.1.0
 * with no prior version. Nearly half of every sweep went to reading the organic
 * rank of apps that cannot rank, because they are not there.
 *
 * The store itself is the signal: an iTunes lookup by bundle id returns
 * `resultCount: 0` for an app that is not published. Verified against all 13 of
 * the owner's apps — 13/13 agreed with their App Store Connect state.
 *
 * Why the PUBLIC listing rather than the ASC `appStoreState` we already read:
 *   • it needs no credentials, so it works on the free tier too — a key-based
 *     check would silently do nothing for exactly the users who have no key;
 *   • it answers the question the user actually asks ("can anyone find my
 *     app?"), which is what ranking depends on.
 *
 * CHECKED, never stored. Apps go live and get pulled; a flag written at connect
 * time is wrong the moment either happens, and stale in between.
 */
import { ITUNES_LOOKUP_URL } from "./constants.js";
import { buildUrl, type FetchFn, fetchJson } from "./itunes.js";

/**
 * True when the App Store returns a listing for this bundle id.
 *
 * FAILS OPEN. A lookup that throws (iTunes down, network blip, rate limit) is
 * not evidence the app was removed — treating it as such would silently stop
 * sweeping every app during an outage, and the agent would go quiet with no
 * explanation. Only an explicit, successful "no results" means not-in-store.
 */
export async function appIsLive(
  fetchFn: FetchFn,
  bundleId: string,
  { country = "US" }: { country?: string } = {},
): Promise<boolean> {
  if (!bundleId.trim()) return true; // nothing to check against — do not block the sweep
  try {
    const data = (await fetchJson(fetchFn, buildUrl(ITUNES_LOOKUP_URL, { bundleId, country }))) as {
      resultCount?: number;
      results?: unknown[];
    };
    // Trust the array over the count: resultCount is a claim, results is the data.
    const n = Array.isArray(data.results) ? data.results.length : (data.resultCount ?? 0);
    return n > 0;
  } catch {
    return true;
  }
}
