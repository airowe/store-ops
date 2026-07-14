/**
 * Session — the device's auth state. The ONLY thing persisted on-device is the
 * signed session token, in the OS keychain via expo-secure-store (Keychain /
 * Keystore). Credentials (.p8 / Play service-account) are NEVER stored here —
 * that invariant is enforced in `lib/credentials.ts` and its tests.
 *
 * Pure logic over an injected/ mocked SecureStore so it tests headlessly. The
 * magic-link → Bearer flow: a deep link carries a magic token → `/auth/exchange`
 * returns a session token (see `cloud` PR — POST /auth/exchange) → we persist it.
 */
import * as SecureStore from "expo-secure-store";
import type { ApiClient } from "../api/client.js";
import { authExchange, me as fetchMe } from "../api/endpoints.js";
import type { AuthExchangeResult, Me } from "../types/api.js";

/** Keychain key for the session token. (Credentials are never given a key.) */
export const SESSION_TOKEN_KEY = "shipaso.session.token";

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
}

/**
 * Extract a magic-link token from a deep link the OS handed us, e.g.
 * `https://shipaso.com/auth/m?token=…` or `shipaso://auth/m?token=…`. Scoped to
 * the `/auth/m` path — a NON-auth deep link that happens to carry a `token`
 * query param (e.g. a shared content URL) must NOT trigger an auth exchange.
 * Returns null for anything else.
 */
export function extractMagicToken(url: string | null | undefined): string | null {
  if (!url) return null;
  // Only the magic-link landing path is an auth link. Tolerate custom-scheme URLs
  // that the URL constructor parses oddly by matching the string directly.
  if (!/(^|\/)auth\/m(\/|\?|#|$)/.test(url)) return null;
  const m = url.match(/[?&]token=([^&#]+)/);
  return m && m[1] ? decodeURIComponent(m[1]) : null;
}

/**
 * Boot check: who are we? Calls `GET /auth/me` with the stored Bearer token.
 * A 401 triggers the client's onUnauthorized (which clears the token), and we
 * report unauthed. Any other failure is surfaced to the caller (offline, etc.).
 */
export async function boot(client: ApiClient): Promise<Me> {
  const token = await getToken();
  if (!token) return { authed: false };
  return fetchMe(client);
}

/**
 * Exchange a magic-link token for a session token and persist it. The session
 * token is returned so the caller can immediately re-boot / route into the app.
 */
export async function exchangeMagicLink(client: ApiClient, magicToken: string): Promise<AuthExchangeResult> {
  const res = await authExchange(client, magicToken);
  await setToken(res.token);
  return res;
}

/** Sign out: drop the on-device token. (No server round-trip needed for Bearer.) */
export async function signOut(): Promise<void> {
  await clearToken();
}
