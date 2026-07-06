/**
 * Shared iTunes HTTP layer — ported from the `_fetch` helpers in
 * aso_rank_check.py / aso_competitor_watch.py / aso_screenshot_score.py.
 *
 * Faithful to the Python behavior:
 *   • retry transient failures (429 / 5xx / timeout / parse error) with
 *     exponential backoff (BACKOFF_BASE * 2**attempt), honoring Retry-After on 429.
 *   • lenient JSON parse: Apple's JSON carries raw control chars inside
 *     description strings (Python used `json.loads(..., strict=False)`); we strip
 *     unescaped control characters before JSON.parse so the parse doesn't throw.
 *
 * Pure / injectable: every public fn takes a `FetchFn` so the engine never
 * touches a global `fetch` and stays unit-testable (and Worker-portable).
 */
import { BACKOFF_BASE, MAX_RETRIES, RETRY_STATUS, USER_AGENT } from "./constants.js";

/** The slice of the WHATWG fetch surface we use. Lets tests inject a mock. */
export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export class ItunesError extends Error {}

/** Sleep indirection so tests can stub it out (mirrors Python's `_sleep`). */
export let sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Test seam: swap the sleeper (e.g. to a no-op) without real timers. */
export function __setSleep(fn: (ms: number) => Promise<void>): void {
  sleep = fn;
}

/**
 * Lenient JSON parse mirroring Python's `json.loads(raw, strict=False)`.
 * Apple embeds raw newlines / control chars inside description strings; a strict
 * parser rejects those. We escape unescaped control chars that sit *inside*
 * string literals, then parse. Falls back to a global strip if a structural
 * pass still fails.
 */
export function lenientJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Walk the text; when inside a string literal, escape bare control chars.
    let out = "";
    let inStr = false;
    let escaped = false;
    for (const ch of raw) {
      const code = ch.charCodeAt(0);
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        out += ch;
        continue;
      }
      if (inStr && code < 0x20) {
        // raw control char inside a string → JSON-escape it
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += "\\u" + code.toString(16).padStart(4, "0");
        continue;
      }
      out += ch;
    }
    return JSON.parse(out);
  }
}

/** Build an iTunes query string (stable param order is irrelevant to the API). */
export function buildUrl(base: string, params: Record<string, string | number>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  return `${base}?${qs.toString()}`;
}

/**
 * Fetch + lenient-parse one URL, retrying transient failures with backoff.
 * Ported from aso_rank_check.py `_fetch`: RETRY_STATUS + JSON parse errors are
 * retried up to MAX_RETRIES; a 429 Retry-After (integer seconds) is honored.
 */
export async function fetchJson(fetchFn: FetchFn, url: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetchFn(url, { headers: { "User-Agent": USER_AGENT } });
      if (!resp.ok) {
        if (RETRY_STATUS.has(resp.status) && attempt < MAX_RETRIES) {
          const retryAfter = resp.headers.get("Retry-After");
          const waitMs =
            retryAfter && /^\d+$/.test(retryAfter)
              ? Number(retryAfter) * 1000
              : BACKOFF_BASE * 1000 * 2 ** attempt;
          await sleep(waitMs);
          continue;
        }
        throw new ItunesError(`HTTP ${resp.status}`);
      }
      const raw = await resp.text();
      return lenientJsonParse(raw);
    } catch (e) {
      lastErr = e;
      // A thrown ItunesError for a non-retryable status should propagate.
      if (e instanceof ItunesError && !/HTTP (403|429|500|502|503|504)/.test(e.message)) {
        throw e;
      }
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_BASE * 1000 * 2 ** attempt);
        continue;
      }
      throw e instanceof ItunesError ? e : new ItunesError(String(e));
    }
  }
  throw new ItunesError(`retries exhausted: ${String(lastErr)}`);
}

/** A single iTunes software result (the fields we read across modules). */
export type ItunesResult = {
  bundleId?: string;
  trackId?: number;
  trackName?: string;
  trackViewUrl?: string;
  version?: string;
  description?: string;
  formattedPrice?: string;
  price?: number;
  averageUserRating?: number;
  userRatingCount?: number;
  genres?: string[];
  screenshotUrls?: string[];
  ipadScreenshotUrls?: string[];
};

export type ItunesResponse = { resultCount?: number; results?: ItunesResult[] };

/** Narrow the lenient-parsed `unknown` into the response shape we expect. */
export function asResponse(data: unknown): ItunesResponse {
  if (data && typeof data === "object") return data as ItunesResponse;
  return {};
}
