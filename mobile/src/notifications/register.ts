/**
 * Push registration — request permission, get the Expo push token, and register
 * it server-side. Degrades GRACEFULLY: a denied permission simply turns the
 * feature off (no error), and a missing server endpoint is a best-effort no-op —
 * the app never breaks because push isn't wired yet.
 *
 * Deps are injected so this tests headlessly without the native module.
 */
import type { ApiClient } from "../api/client.js";

export type PushDeps = {
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: () => Promise<{ data: string }>;
};

export type RegisterResult =
  | { ok: true; token: string }
  | { ok: false; reason: "denied" | "error" };

/**
 * The token this install last registered — MEMORY ONLY (never persisted; the
 * never-persisted invariant covers only credentials, but we still add no new
 * storage). Captured so sign-out can unregister the device WITHOUT a fresh
 * network round-trip to exp.host (which fails offline/permission-denied — the
 * exact moment sign-out must still work). Null until a successful registration.
 */
let lastKnownPushToken: string | null = null;

export function getLastKnownPushToken(): string | null {
  return lastKnownPushToken;
}

/** Test seam / sign-out cleanup. */
export function __setLastKnownPushToken(token: string | null): void {
  lastKnownPushToken = token;
}

/**
 * Ensure permission (prompting only if undetermined), fetch the push token, and
 * POST it to the device-token endpoint. The server call is best-effort: a failure
 * (e.g. the endpoint doesn't exist yet) still returns ok with the token.
 */
export async function registerForPush(client: ApiClient, deps: PushDeps): Promise<RegisterResult> {
  try {
    let { status } = await deps.getPermissionsAsync();
    if (status !== "granted") {
      status = (await deps.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return { ok: false, reason: "denied" };

    const { data: token } = await deps.getExpoPushTokenAsync();
    lastKnownPushToken = token; // captured for sign-out cleanup (memory only)

    // Best-effort server registration — never fail the feature on a 404/offline.
    try {
      await client.post("/account/push-token", { token });
    } catch {
      /* server hook may not exist yet; the token is still valid locally */
    }
    return { ok: true, token };
  } catch {
    return { ok: false, reason: "error" };
  }
}
