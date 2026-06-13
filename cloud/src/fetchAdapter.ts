/**
 * Adapt the Worker runtime's global `fetch` to the engine's narrow `FetchFn`.
 *
 * The engine deliberately depends on a tiny structural slice of fetch (so it can
 * be unit-tested with a mock). The Workers global `fetch` is a superset of that
 * slice, but the param/return types aren't *identical*, so we wrap it once here
 * instead of sprinkling `as never` casts across the API and cron layers.
 */
import type { FetchFn } from "./engine/index.js";

export const workerFetch: FetchFn = async (url, init) => {
  const resp = await fetch(url, init?.headers ? { headers: init.headers } : undefined);
  return {
    ok: resp.ok,
    status: resp.status,
    headers: { get: (name: string) => resp.headers.get(name) },
    text: () => resp.text(),
  };
};
