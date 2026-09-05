/**
 * Bounded retry for the post-deploy smoke test (#491).
 *
 * Right after a deploy the two edge cache keys (with and without `Origin`)
 * can disagree for a short window: index.html names a bundle the
 * Origin-keyed edge has not received yet, and the crossorigin asset check
 * 404s on a deployment that is healthy a minute later. That is a
 * propagation delay, not an outage — so it is retried, briefly and visibly.
 *
 * Everything else is NOT retried. A wrong MIME type on an asset is the cached
 * HTML poisoning this check exists to catch, and it does not heal by waiting;
 * retrying it would only delay the alarm. `shouldRetry` decides.
 */

/**
 * Run `fn` up to `attempts` times, waiting `delayMs` between tries, retrying
 * only errors `shouldRetry` accepts. `onRetry` is called with (attempt, err)
 * before each wait so the smoke log shows what was waited for. Returns fn's
 * value; rethrows the last error when attempts are exhausted or the error is
 * not retryable.
 */
export async function withRetry(fn, { attempts = 6, delayMs = 10_000, shouldRetry, onRetry, sleep = defaultSleep } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      last = err;
      const retryable = shouldRetry ? shouldRetry(err) : true;
      if (!retryable || attempt === attempts) throw err;
      if (onRetry) onRetry(attempt, err);
      await sleep(delayMs);
    }
  }
  throw last;
}

/** A 404 on a freshly named asset is the propagation race; nothing else is. */
export function isPropagation404(err) {
  return /→ 404\b/.test(String(err?.message ?? ""));
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
