/**
 * Sign-out with device cleanup (comms-prefs Phase 4). ORDERING IS LOAD-BEARING:
 * `DELETE /account/push-token` requires auth, so the unregister MUST run before
 * the session token is cleared — and it is strictly best-effort: a failed or
 * impossible DELETE (offline, no token captured, server error) NEVER blocks the
 * sign-out itself. The server-side pref gate still protects a device whose
 * token could not be removed.
 */
import type { ApiClient } from "../api/client.js";
import { deletePushToken } from "../api/endpoints.js";

export type SignOutDeps = {
  client: ApiClient;
  /** the token this install registered (memory capture), or null. */
  getKnownToken: () => string | null;
  /** OPTIONAL fallback (fresh getExpoPushTokenAsync) — a network call; may fail. */
  fetchFreshToken?: (() => Promise<string | null>) | undefined;
  /** the actual session teardown (AuthProvider.signOut). Always runs. */
  signOut: () => Promise<void>;
};

export async function signOutWithCleanup(deps: SignOutDeps): Promise<void> {
  try {
    let token = deps.getKnownToken();
    if (!token && deps.fetchFreshToken) {
      token = await deps.fetchFreshToken().catch(() => null);
    }
    if (token) {
      await deletePushToken(deps.client, token);
    }
  } catch {
    // best-effort — a cleanup failure must never strand the user signed in.
  }
  await deps.signOut();
}
