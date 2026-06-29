import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client.js";
import { ApiError } from "./errors.js";

/** Build a fake fetch that records the last call and returns a canned Response. */
function fakeFetch(
  res: { status?: number; body?: unknown; throwErr?: Error },
): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (res.throwErr) throw res.throwErr;
    const status = res.status ?? 200;
    const text = res.body === undefined ? "" : JSON.stringify(res.body);
    return new Response(text, { status });
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

const BASE = "https://api.shipaso.com";

describe("createApiClient", () => {
  it("attaches the Bearer header when a token is present", async () => {
    const { fetch, calls } = fakeFetch({ body: { authed: true } });
    const client = createApiClient({ baseUrl: BASE, fetch, getToken: () => "tok-123" });

    await client.get("/auth/me");

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok-123");
  });

  it("omits the Bearer header when there is no token (logged-out calls work)", async () => {
    const { fetch, calls } = fakeFetch({ body: { ok: true } });
    const client = createApiClient({ baseUrl: BASE, fetch, getToken: () => null });

    await client.get("/proof");

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("awaits an async token provider", async () => {
    const { fetch, calls } = fakeFetch({ body: {} });
    const client = createApiClient({
      baseUrl: BASE,
      fetch,
      getToken: async () => "async-tok",
    });

    await client.get("/auth/me");

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer async-tok");
  });

  it("invokes onUnauthorized exactly once on a 401, then rejects with ApiError", async () => {
    const { fetch } = fakeFetch({ status: 401, body: { error: "session expired" } });
    const onUnauthorized = vi.fn();
    const client = createApiClient({ baseUrl: BASE, fetch, onUnauthorized });

    await expect(client.get("/apps")).rejects.toMatchObject({
      status: 401,
      message: "session expired",
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("normalizes a non-2xx into an ApiError carrying the server message", async () => {
    const { fetch } = fakeFetch({ status: 402, body: { error: "upgrade to Scale" } });
    const client = createApiClient({ baseUrl: BASE, fetch });

    const err = (await client.get("/portfolio").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(402);
    expect(err.message).toBe("upgrade to Scale");
  });

  it("maps a transport failure to ApiError {status:0} (isNetwork)", async () => {
    const { fetch } = fakeFetch({ throwErr: new Error("Network request failed") });
    const client = createApiClient({ baseUrl: BASE, fetch });

    const err = (await client.get("/auth/me").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.isNetwork).toBe(true);
  });

  it("POSTs a JSON body with the right method and content-type", async () => {
    const { fetch, calls } = fakeFetch({ body: { sent: true } });
    const client = createApiClient({ baseUrl: BASE, fetch });

    await client.post("/auth/request", { email: "a@b.com" });

    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(calls[0]!.init.body).toBe(JSON.stringify({ email: "a@b.com" }));
  });

  it("joins base + path without doubling slashes", async () => {
    const { fetch, calls } = fakeFetch({ body: {} });
    const client = createApiClient({ baseUrl: `${BASE}/`, fetch });

    await client.get("/auth/me");
    expect(calls[0]!.url).toBe(`${BASE}/auth/me`);
  });

  it("returns undefined for an empty 2xx body without throwing", async () => {
    const { fetch } = fakeFetch({ status: 200 }); // body omitted → empty text
    const client = createApiClient({ baseUrl: BASE, fetch });

    await expect(client.get("/health")).resolves.toBeUndefined();
  });

  it("merges defaultHeaders (e.g. the demo X-User-Email path)", async () => {
    const { fetch, calls } = fakeFetch({ body: {} });
    const client = createApiClient({
      baseUrl: BASE,
      fetch,
      defaultHeaders: { "X-User-Email": "demo@shipaso.com" },
    });

    await client.get("/apps");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["X-User-Email"]).toBe("demo@shipaso.com");
  });
});
