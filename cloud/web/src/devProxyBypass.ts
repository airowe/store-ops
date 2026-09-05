/**
 * Dev-server proxy bypass (#482).
 *
 * `vite.config.ts` proxies every API path prefix to the local Worker so the
 * session cookie is same-site. But `/apps/:id`, `/runs/:id`, and
 * `/apps/:id/war-room` are ALSO client-side routes, and the proxy wins over
 * the SPA fallback — so opening the app detail page in a browser returned the
 * API's JSON. Setting VITE_API_BASE did not help; `server.proxy` is
 * unconditional.
 *
 * The distinguishing signal is the `Accept` header: a browser NAVIGATION asks
 * for `text/html`; the spine's fetches ask for JSON (or `*\/*`). Navigations
 * get the SPA shell; everything else still proxies. Pure, so it is unit-tested.
 */
export type ProxyRequestLike = { headers: { accept?: string | string[] | undefined } };

/** The path Vite should serve instead of proxying, or undefined to proxy. */
export function spaBypass(req: ProxyRequestLike): string | undefined {
  const raw = req.headers.accept;
  const accept = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  return accept.toLowerCase().includes("text/html") ? "/index.html" : undefined;
}
