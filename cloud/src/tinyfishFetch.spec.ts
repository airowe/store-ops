import { describe, expect, it, vi } from "vitest";
import { decodeEntities, makeTinyfishFetch, unwrapBody } from "./tinyfishFetch.js";

const ITUNES_JSON = JSON.stringify({ resultCount: 1, results: [{ bundleId: "app.airowe.clarity" }] });

describe("decodeEntities", () => {
  it("decodes &amp; back to & (the real-world iTunes case)", () => {
    expect(decodeEntities("Headspace: Sleep &amp; Meditation")).toBe(
      "Headspace: Sleep & Meditation",
    );
  });

  it("decodes &lt; &gt; &#39; &apos;", () => {
    expect(decodeEntities("a &lt;b&gt; c&#39;s &apos;quote&apos;")).toBe("a <b> c's 'quote'");
  });

  it("does NOT bare a quote entity (would corrupt still-encoded JSON)", () => {
    // &quot; is left as-is; numeric quote refs are kept inert as &#34;
    expect(decodeEntities('say &quot;hi&quot;')).toBe('say &quot;hi&quot;');
    expect(decodeEntities("x &#34; y &#x22; z")).toBe("x &#34; y &#34; z");
  });

  it("a body with &amp; parses cleanly after unwrap (end-to-end of the fix)", () => {
    const encoded = JSON.stringify({ results: [{ trackName: "Sleep XXX Meditation" }] }).replace(
      "XXX",
      "&amp;",
    );
    const parsed = JSON.parse(unwrapBody(encoded));
    expect(parsed.results[0].trackName).toBe("Sleep & Meditation");
  });
});

describe("unwrapBody", () => {
  it("returns a plain JSON string unchanged", () => {
    expect(unwrapBody(ITUNES_JSON)).toBe(ITUNES_JSON);
  });

  it("strips a ```json fenced code block (markdown format wraps raw JSON)", () => {
    const fenced = "```json\n" + ITUNES_JSON + "\n```";
    expect(unwrapBody(fenced)).toBe(ITUNES_JSON);
  });

  it("strips a bare ``` fenced block", () => {
    const fenced = "```\n" + ITUNES_JSON + "\n```";
    expect(unwrapBody(fenced)).toBe(ITUNES_JSON);
  });

  it("serializes an object body (format=json returns a document tree/object)", () => {
    const obj = { resultCount: 1, results: [{ bundleId: "x" }] };
    expect(unwrapBody(obj)).toBe(JSON.stringify(obj));
  });
});

describe("makeTinyfishFetch", () => {
  function tfResponse(text: unknown) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ results: [{ url: "u", text }], errors: [] }),
    };
  }

  it("POSTs the target URL to the TinyFish endpoint with the API key header", async () => {
    const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
    const inner = (async (url: string, init: Record<string, unknown>) => {
      calls.push({ url, init: init ?? {} });
      return tfResponse(ITUNES_JSON);
    }) as never;
    const fetchFn = makeTinyfishFetch(inner, "tf_key_123");

    await fetchFn("https://itunes.apple.com/search?term=calm", { headers: { "User-Agent": "x" } });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.fetch.tinyfish.ai");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["X-API-Key"]).toBe("tf_key_123");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.urls).toEqual(["https://itunes.apple.com/search?term=calm"]);
    expect(body.format).toBe("html");
  });

  it("returns the unwrapped iTunes body as text(), with ok/status passthrough", async () => {
    const inner = vi.fn(async () => tfResponse("```json\n" + ITUNES_JSON + "\n```"));
    const fetchFn = makeTinyfishFetch(inner as never, "k");

    const resp = await fetchFn("https://itunes.apple.com/search?term=calm");
    expect(resp.ok).toBe(true);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe(ITUNES_JSON);
  });

  it("surfaces a per-URL TinyFish error as a non-ok response", async () => {
    const inner = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({ results: [], errors: [{ url: "u", message: "blocked" }] }),
    }));
    const fetchFn = makeTinyfishFetch(inner as never, "k");

    const resp = await fetchFn("https://itunes.apple.com/search?term=calm");
    expect(resp.ok).toBe(false);
    expect(resp.status).toBeGreaterThanOrEqual(400);
  });

  it("propagates a TinyFish transport failure as a non-ok response", async () => {
    const inner = vi.fn(async () => ({
      ok: false,
      status: 502,
      headers: { get: () => null },
      text: async () => "bad gateway",
    }));
    const fetchFn = makeTinyfishFetch(inner as never, "k");

    const resp = await fetchFn("https://itunes.apple.com/search?term=calm");
    expect(resp.ok).toBe(false);
    expect(resp.status).toBe(502);
  });
});
