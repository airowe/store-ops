/**
 * The portable API client — the one place the phone talks to the Worker API.
 *
 * Deliberately Expo-free and dependency-free: `fetch`, the token source, and the
 * 401 handler are all INJECTED. That keeps this file unit-testable in plain Node
 * (no RN, no SecureStore) and lets the Expo layer wire the real implementations
 * (`expo-secure-store` for the token, the router's sign-out for `onUnauthorized`).
 *
 * Contract (Phase 0 acceptance criteria):
 *   • attaches `Authorization: Bearer <token>` when a token is present; omits it
 *     when absent (logged-out calls like `/proof` still work).
 *   • a 401 invokes the injected `onUnauthorized` hook (sign-out), then rejects.
 *   • every non-2xx → a normalized `ApiError {status, message}`; a transport
 *     failure → `ApiError {status:0}` (`isNetwork`).
 *   • JSON in, JSON out; the body is parsed honestly (empty → undefined).
 */
import { ApiError, messageFromBody } from "./errors.js";

/** Provides the current session token (from SecureStore in the app). */
export type TokenProvider = () => string | null | undefined | Promise<string | null | undefined>;

export type ApiClientConfig = {
  /** e.g. "https://api.shipaso.com" (from `app.config.ts` extra.apiBase). */
  baseUrl: string;
  /** the injected fetch (global fetch in RN/Node; a fake in tests). */
  fetch: typeof fetch;
  /** the session token source; return null/undefined when logged out. */
  getToken?: TokenProvider;
  /** called once on any 401 so the app can drop the token + route to login. */
  onUnauthorized?: () => void;
  /**
   * extra headers for the dev/demo path only (e.g. `X-User-Email`). Never used
   * to carry credentials — those go in the request body, used once.
   */
  defaultHeaders?: Record<string, string>;
};

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** a JSON-serializable body (sent as application/json). */
  body?: unknown;
  /** per-call header overrides. */
  headers?: Record<string, string>;
  /** abort signal for cancellation. */
  signal?: AbortSignal;
};

export type ApiClient = {
  request<T>(path: string, opts?: RequestOptions): Promise<T>;
  get<T>(path: string, opts?: Omit<RequestOptions, "method" | "body">): Promise<T>;
  post<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">): Promise<T>;
};

/** Join a base URL and a path without doubling or dropping the slash. */
function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path; // already absolute
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Does this URL live on the same origin as the configured API base? */
function sameOriginAsBase(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false; // unparseable → never trust it with the token
  }
}

/** Parse a Response body as JSON, tolerating an empty body (→ undefined). */
async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text; // not JSON — surface the raw text (errors, plain strings)
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const token = config.getToken ? await config.getToken() : undefined;
    const url = joinUrl(config.baseUrl, path);

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...config.defaultHeaders,
      ...opts.headers,
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    // Bearer is attached ONLY when we actually have a token (logged-out → omit)
    // AND the request stays on the API's own origin — an absolute URL to any
    // other host (should one ever reach here) must never carry the session token.
    if (token && sameOriginAsBase(url, config.baseUrl)) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const init: RequestInit = {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    if (opts.signal) init.signal = opts.signal;

    let res: Response;
    try {
      res = await config.fetch(url, init);
    } catch (err) {
      // Transport/abort failure: never produced an HTTP response.
      const message = err instanceof Error ? err.message : "network request failed";
      throw new ApiError(0, message);
    }

    const body = await parseBody(res);

    if (res.status === 401) {
      // Fire the sign-out hook exactly once, then reject so the caller knows.
      config.onUnauthorized?.();
      throw new ApiError(401, messageFromBody(body, "unauthorized"), body);
    }

    if (!res.ok) {
      throw new ApiError(res.status, messageFromBody(body, `request failed (${res.status})`), body);
    }

    return body as T;
  }

  return {
    request,
    get: (path, opts) => request(path, { ...opts, method: "GET" }),
    post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
  };
}
