/**
 * Adapt the Worker runtime's global `fetch` to the engine's narrow `FetchFn`.
 *
 * The engine deliberately depends on a tiny structural slice of fetch (so it can
 * be unit-tested with a mock). The Workers global `fetch` is a superset of that
 * slice, but the param/return types aren't *identical*, so we wrap it once here
 * instead of sprinkling `as never` casts across the API and cron layers.
 */
import type { FetchFn } from "./engine/index.js";
import { makeTinyfishFetch } from "./tinyfishFetch.js";
import { makeFallbackFetch } from "./resilientFetch.js";
import type { Env } from "./index.js";

export const workerFetch: FetchFn = async (url, init) => {
  // method/body ride along on the init even though FetchFn only types `headers`
  // (the TinyFish adapter sets them). Pass the whole init through to global fetch.
  const resp = await fetch(url, init as RequestInit | undefined);
  return {
    ok: resp.ok,
    status: resp.status,
    headers: { get: (name: string) => resp.headers.get(name) },
    text: () => resp.text(),
  };
};

/**
 * Pick the engine's transport for this environment. With TINYFISH_API_KEY set
 * (production), iTunes calls route through TinyFish Fetch (clean egress) to dodge
 * Apple's 403 on Cloudflare egress — but if TinyFish itself errors (throws or
 * returns a retryable status), we fall back to the plain Worker fetch so a
 * TinyFish outage doesn't take the whole run down. Without a key (local/dev,
 * where direct fetch works), use the plain Worker fetch alone.
 */
export function fetchForEnv(env: Env): FetchFn {
  if (!env.TINYFISH_API_KEY) return workerFetch;
  const tinyfish = makeTinyfishFetch(workerFetch, env.TINYFISH_API_KEY);
  return makeFallbackFetch(tinyfish, workerFetch);
}
