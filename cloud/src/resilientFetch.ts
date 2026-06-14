/**
 * Resilient fallback transport for the engine's `FetchFn`.
 *
 * WHY: a single egress path can fail in two distinct ways — it can THROW
 * (DNS/TLS/timeout, the transport never produced a response) or it can return a
 * response whose status signals a transient/datacenter block (403 from Apple,
 * 429/5xx). In both cases a *different* egress path may succeed. `makeFallbackFetch`
 * wraps a primary transport and, on either failure mode, retries the request
 * once through a fallback transport — so e.g. TinyFish-primary can fall back to
 * direct fetch, or vice-versa, without the engine knowing.
 *
 * It deliberately does NOT fall back on ok responses or on real client errors
 * like 404 (a genuine "not found", not a transport failure): only statuses in
 * `retryStatuses` (default the engine's RETRY_STATUS) are treated as retryable.
 */
import { RETRY_STATUS } from "./engine/index.js";
import type { FetchFn } from "./engine/index.js";

export type FallbackOpts = { retryStatuses?: Set<number> };

export function makeFallbackFetch(
  primary: FetchFn,
  fallback: FetchFn,
  opts?: FallbackOpts,
): FetchFn {
  const retryStatuses = opts?.retryStatuses ?? RETRY_STATUS;

  return async (url, init) => {
    try {
      const resp = await primary(url, init);
      // Primary produced a usable response (ok, or a hard client error like 404):
      // return it directly and never touch the fallback.
      if (!retryStatuses.has(resp.status)) return resp;
      // Retryable status → try the fallback; return whatever it yields (even if
      // that's also a retryable status — the caller still gets a result, and we
      // tried both paths).
      return await fallback(url, init);
    } catch {
      // Primary THREW (transport-level failure) → try the fallback. If the
      // fallback also throws, let that error propagate so the caller sees it.
      return await fallback(url, init);
    }
  };
}
