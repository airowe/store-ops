/**
 * Debounced, race-safe auto-search controller for the app-search boxes.
 *
 * The preview + connect search inputs used to require a manual click. This drives
 * type-to-search: 3+ chars → debounced de-duped query, with an out-of-order
 * guard so a slow earlier response can't clobber a newer one. It is framework-
 * free (the DOM layer just calls `input`/`submit`/`onClear` and provides a
 * `fetcher`), which keeps the timing + staleness rules unit-testable.
 *
 * The SAME shape is mirrored inline in public/app.js (plain browser JS); this TS
 * copy is the tested specification of the behavior. Keep them in sync.
 */

export type SearchControllerOpts = {
  /** Minimum query length before any network call (shorter → no-op/clear). */
  minChars: number;
  /** Debounce window in ms (trailing edge). */
  delayMs: number;
  /** Issues the actual search for a query; resolves with whatever the UI renders. */
  fetcher: (query: string) => Promise<unknown>;
  /** Called with the result for the query that is still current when it resolves. */
  onResult: (result: unknown, query: string) => void;
  /** Optional scheduler hooks (default to globals) — injected in tests if needed. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
};

export type SearchController = {
  /** Feed the current input value (raw); debounces + fires when eligible. */
  input: (value: string) => void;
  /** Fire immediately for the current value (Enter / button), skipping debounce. */
  submit: () => void;
  /** Register a callback for when the input is emptied (clear the results UI). */
  onClear: (fn: () => void) => void;
};

export function createSearchController(opts: SearchControllerOpts): SearchController {
  const setT = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let timer: unknown = null;
  let lastFed = ""; // most recent trimmed input value (drives submit())
  let lastQueried = ""; // the query we last issued/showed (for de-dup)
  let seq = 0; // monotonic id; only the latest in-flight response is applied
  let clearCb: (() => void) | null = null;

  function cancelTimer() {
    if (timer != null) {
      clearT(timer);
      timer = null;
    }
  }

  /** Issue the search now (no debounce). De-dups against the last shown query. */
  function fire(query: string) {
    cancelTimer();
    if (query.length < opts.minChars) return;
    if (query === lastQueried) return; // already shown — don't refetch
    lastQueried = query;
    const mine = ++seq;
    void opts.fetcher(query).then((result) => {
      if (mine !== seq) return; // a newer search superseded this one → drop it
      opts.onResult(result, query);
    });
  }

  function input(value: string) {
    const q = value.trim();
    lastFed = q;
    cancelTimer();
    if (q.length === 0) {
      // Empty input → abandon any pending/in-flight result and clear the UI.
      lastQueried = "";
      seq++; // invalidate any in-flight response
      clearCb?.();
      return;
    }
    if (q.length < opts.minChars) return; // too short to search yet
    if (q === lastQueried) return; // unchanged from what's already shown
    timer = setT(() => {
      timer = null;
      fire(q);
    }, opts.delayMs);
  }

  function submit() {
    fire(lastFed);
  }

  return {
    input,
    submit,
    onClear(fn) {
      clearCb = fn;
    },
  };
}
