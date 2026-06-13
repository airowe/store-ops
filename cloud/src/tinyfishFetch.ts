/**
 * TinyFish-backed FetchFn for the engine.
 *
 * WHY: Apple's iTunes Search API (`/search`, and intermittently `/lookup?id=`)
 * returns 403 to Cloudflare Worker egress IPs — a datacenter-IP reputation block
 * that headers/retries don't fix. TinyFish's Fetch endpoint renders the target
 * in a real (stealth) browser from clean egress and hands back the body, so the
 * engine gets the same iTunes JSON it would from a normal IP.
 *
 * The engine stays untouched: this returns the engine's narrow FetchFn shape
 * (`{ok, status, headers.get, text()}`), with `text()` resolving to the RAW
 * iTunes JSON string — exactly what `fetchJson` + `lenientJsonParse` expect.
 *
 * Format note (verified against the live API):
 *   • `format:"html"`     → returns the raw iTunes JSON body verbatim. USE THIS.
 *   • `format:"markdown"` → also returns the JSON, but the markdown formatter
 *     escapes `_`/`*` inside it (`..._iPhone\_5.5\_...`), and `\_` is an invalid
 *     JSON escape that JSON.parse rejects. Do not use for raw-JSON endpoints.
 *   • `format:"json"`     → TinyFish parses the page as a doc tree → `proxy_error`.
 */
import type { FetchFn } from "./engine/index.js";

export const TINYFISH_FETCH_URL = "https://api.fetch.tinyfish.ai";

type TinyfishResult = { url: string; final_url?: string; text?: unknown };
type TinyfishResponse = {
  results?: TinyfishResult[];
  errors?: Array<{ url: string; error?: string; message?: string }>;
};

/**
 * Decode the HTML entities TinyFish's html formatter injects into JSON string
 * values (e.g. iTunes' `Sleep & Meditation` comes back as `Sleep &amp;
 * Meditation`). Run BEFORE JSON.parse so values are clean everywhere downstream.
 *
 * IMPORTANT: we deliberately do NOT decode `&quot;`/`&#34;` here. The body is
 * still-encoded JSON at this point; turning an entity into a bare `"` could
 * inject a structural quote and corrupt the parse. The entities we decode
 * (`&`, `<`, `>`, `'`, and numeric refs other than 34) can't introduce a `"` or
 * `\`, so they're safe pre-parse. In practice iTunes only emits `&amp;`.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x0*22;/gi, "&#34;") // keep a literal-quote ref inert (don't bare it)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const cp = parseInt(h, 16);
      return cp === 0x22 ? "&#34;" : String.fromCodePoint(cp);
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const cp = parseInt(d, 10);
      return cp === 0x22 ? "&#34;" : String.fromCodePoint(cp);
    });
}

/**
 * Normalize a TinyFish `text` payload into the raw body string the engine wants.
 * The html-format page comes back as the JSON string itself (with HTML entities
 * encoded — we decode them); we also defensively strip a ```/```json code fence
 * if one is ever present, and stringify an object (if a format returns a tree).
 *
 * NOTE: decoding `&quot;` could in theory alter a JSON string value that
 * legitimately contained the literal text `&quot;`, but iTunes payloads don't,
 * and the alternative (mangled `&amp;` in every app name) is the real-world bug.
 */
export function unwrapBody(text: unknown): string {
  if (text != null && typeof text === "object") return JSON.stringify(text);
  const s = String(text ?? "");
  const fence = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  return decodeEntities((fence?.[1] ?? s).trim());
}

/**
 * Build a FetchFn that routes every request through TinyFish Fetch.
 * `inner` is the underlying transport (the Worker's wrapped global fetch); it's
 * injected so this is unit-testable without a runtime.
 */
export function makeTinyfishFetch(inner: FetchFn, apiKey: string): FetchFn {
  return async (url) => {
    const resp = await inner(TINYFISH_FETCH_URL, {
      // The engine's FetchFn init only types `headers`; method/body ride along
      // (the real transport honors them). Cast through the structural shape.
      ...{
        method: "POST",
        body: JSON.stringify({ urls: [url], format: "html" }),
      },
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    } as Parameters<FetchFn>[1]);

    // TinyFish transport itself failed (auth, 5xx, …) → propagate as-is so the
    // engine's retry policy can see the status.
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        headers: { get: () => null },
        text: async () => await resp.text(),
      };
    }

    const body = JSON.parse(await resp.text()) as TinyfishResponse;
    const first = body.results?.[0];
    if (!first || first.text == null) {
      // Per-URL fetch error (e.g. proxy_error) → present as a retryable 502 so
      // the engine backs off rather than treating empty as a hard failure.
      const detail = body.errors?.[0]?.error ?? body.errors?.[0]?.message ?? "no result";
      return {
        ok: false,
        status: 502,
        headers: { get: () => null },
        text: async () => `tinyfish: ${detail}`,
      };
    }

    const raw = unwrapBody(first.text);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => raw,
    };
  };
}
