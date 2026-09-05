/**
 * Guards for `GET /report/:appId` — the public, unauthenticated funnel.
 *
 * Every cache miss on that route runs the agent, and the agent reasons with the
 * Anthropic client built by `reasonerForEnv`. So an unauthenticated request
 * spends inference money on our key. A live check confirmed three concurrent
 * requests for unrelated apps (WhatsApp, Facebook, Google Maps) were all served
 * with nothing throttling them, and a repeat call for the same app recomputed
 * from scratch — 16.5s, then 12.6s.
 *
 * Two guards, in order of how much they actually help:
 *
 *   1. The CACHE. An audit of a public listing is stable for hours, so the
 *      repeat cost should be zero. This is the real fix.
 *   2. The LIMITER. A damper on hammering a single app. Cloudflare's own
 *      documentation is explicit that the binding is "permissive, eventually
 *      consistent, and intentionally designed to not be used as an accurate
 *      accounting system", and that a limit applies per Cloudflare location —
 *      an attacker spread across locations gets a multiple of it. It must
 *      never be described, or relied on, as a spend cap.
 *
 * Both fail OPEN. This route is the funnel; a broken cache or an unbound
 * limiter must degrade to "compute it" rather than to an error page.
 */

/** How long a public audit stays fresh. A listing does not change by the minute. */
const CACHE_SECONDS = 6 * 60 * 60;

/**
 * The Cache API keys on a URL, so the identity of a report has to be expressed
 * as one. `appId` arrives from the request path, so it is encoded rather than
 * interpolated: a stray slash would otherwise invent a path segment and let one
 * app's key collide with another's.
 */
export function reportCacheKey(appId: string, country: string): string {
  return `https://cache.shipaso.internal/report/${encodeURIComponent(appId)}/${encodeURIComponent(country)}`;
}

/**
 * The anonymous MCP `preview_app` (loop 2026-09-05) reuses this guard, but its
 * identity is a bundle id + country rather than a numeric App Store id. Its
 * own path segment keeps the two namespaces apart even for identical text.
 */
export function previewCacheKey(bundleId: string, country: string): string {
  return `https://cache.shipaso.internal/preview/${encodeURIComponent(bundleId)}/${encodeURIComponent(country)}`;
}

/** The slice of the Cache API this module needs, so tests can supply a fake. */
export type ReportCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

/**
 * The default cache, or undefined where there is none.
 *
 * `caches` is a Workers global; it is absent under plain vitest and in any
 * non-Worker runtime. Reading it unguarded threw a ReferenceError that turned
 * the whole public route into a 500 — the exact failure this module exists to
 * prevent.
 */
export function defaultReportCache(): ReportCache | undefined {
  return typeof caches === "undefined" ? undefined : (caches.default as unknown as ReportCache);
}

/**
 * Serves a cached report when one is fresh, otherwise computes and stores it.
 *
 * A thrown `compute` is never cached: a transient iTunes outage must not be
 * frozen in for the whole window. A thrown cache is never fatal.
 */
export async function cachedReport<T>(
  appId: string,
  country: string,
  cache: ReportCache | undefined,
  compute: () => Promise<T>,
): Promise<T> {
  return cachedByKey(reportCacheKey(appId, country), cache, compute);
}

/** The same cache contract for any URL-shaped key (report, preview, …). */
export async function cachedByKey<T>(
  key: string,
  cache: ReportCache | undefined,
  compute: () => Promise<T>,
): Promise<T> {
  // No cache available (non-Worker runtime) is not an error: compute and serve.
  if (cache === undefined) return compute();

  const request = new Request(key);

  try {
    const hit = await cache.match(request);
    if (hit !== undefined) return (await hit.json()) as T;
  } catch {
    // A broken cache is not a reason to fail the request.
  }

  const value = await compute();

  try {
    await cache.put(
      request,
      new Response(JSON.stringify(value), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${CACHE_SECONDS}`,
        },
      }),
    );
  } catch {
    // Serving the freshly computed value still beats failing.
  }

  return value;
}

/** The shape of Cloudflare's rate limiting binding, as documented. */
export type ReportLimiter = { limit(input: { key: string }): Promise<{ success: boolean }> };

/**
 * Whether this report may be computed now.
 *
 * Keyed on the app, not the caller's address: Cloudflare advises against IP
 * keys because addresses are shared by many valid users, and the abuse that
 * costs money here is hammering one app rather than one visitor being busy.
 *
 * Returns true when no limiter is bound (local dev, tests) and when the binding
 * throws. A damper that fails closed would take the public funnel down.
 */
export async function allowReport(
  limiter: ReportLimiter | undefined,
  appId: string,
): Promise<boolean> {
  if (limiter === undefined) return true;
  try {
    const { success } = await limiter.limit({ key: `report:${appId}` });
    return success;
  } catch {
    return true;
  }
}
