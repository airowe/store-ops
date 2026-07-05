/**
 * Transport-agnostic REST client. The single seam that lets ONE client serve
 * both surfaces: each injects its own `fetch` + auth strategy —
 *   • native: SecureStore session token → Authorization/X-User-Email header
 *   • web: cookie session (credentials:"include"), no explicit token
 * so the endpoint wrappers (endpoints.ts) are identical everywhere.
 */
import { ApiError } from "./errors.js";

export type ClientConfig = {
  /** e.g. https://api.shipaso.com */
  baseUrl: string;
  /** Injected fetch (global on web/native; a mock in tests). */
  fetchImpl?: typeof fetch;
  /** Per-request auth headers (token on native; {} on web + credentials). */
  authHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Whether to send cookies (web session). */
  credentials?: RequestCredentials;
};

export type ApiClient = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
};

export function createClient(config: ClientConfig): ApiClient {
  const doFetch = config.fetchImpl ?? fetch;

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { ...(await config.authHeaders?.()) };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await doFetch(config.baseUrl + path, {
      method,
      headers,
      credentials: config.credentials,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const msg = (parsed && (parsed.error || parsed.message)) || `HTTP ${res.status}`;
      throw new ApiError(res.status, msg, parsed);
    }
    return parsed as T;
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
  };
}
