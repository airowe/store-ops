/**
 * Sign-out cleanup ordering (comms-prefs Phase 4) — THE invariant: the device
 * token DELETE runs while STILL AUTHED (before the session teardown), and no
 * cleanup failure ever blocks the sign-out itself.
 */
import type { ApiClient } from "../api/client.js";
import { signOutWithCleanup } from "./signout.js";

const TOKEN = "ExpoPushToken[device-1]";

function recordingClient(events: string[], opts: { failDelete?: boolean } = {}): ApiClient {
  const call = async <T,>(path: string, o?: { method?: string }) => {
    events.push(`${o?.method ?? "GET"} ${path}`);
    if (opts.failDelete) throw new Error("network down");
    return { removed: true } as T;
  };
  return {
    get: call,
    post: call,
    request: (path: string, o?: { method?: string }) => call(path, o),
  } as unknown as ApiClient;
}

describe("signOutWithCleanup", () => {
  it("ORDERING: DELETE fires BEFORE the session teardown", async () => {
    const events: string[] = [];
    await signOutWithCleanup({
      client: recordingClient(events),
      getKnownToken: () => TOKEN,
      signOut: async () => void events.push("SIGN_OUT"),
    });
    expect(events).toEqual(["DELETE /account/push-token", "SIGN_OUT"]);
  });

  it("a failed DELETE never blocks sign-out", async () => {
    const events: string[] = [];
    await signOutWithCleanup({
      client: recordingClient(events, { failDelete: true }),
      getKnownToken: () => TOKEN,
      signOut: async () => void events.push("SIGN_OUT"),
    });
    expect(events[events.length - 1]).toBe("SIGN_OUT");
  });

  it("no captured token → tries the fallback; fallback failure still signs out", async () => {
    const events: string[] = [];
    await signOutWithCleanup({
      client: recordingClient(events),
      getKnownToken: () => null,
      fetchFreshToken: async () => {
        throw new Error("offline"); // exp.host unreachable at sign-out time
      },
      signOut: async () => void events.push("SIGN_OUT"),
    });
    expect(events).toEqual(["SIGN_OUT"]); // no DELETE attempted, sign-out completed
  });

  it("fallback token IS used when the capture is empty", async () => {
    const events: string[] = [];
    await signOutWithCleanup({
      client: recordingClient(events),
      getKnownToken: () => null,
      fetchFreshToken: async () => TOKEN,
      signOut: async () => void events.push("SIGN_OUT"),
    });
    expect(events).toEqual(["DELETE /account/push-token", "SIGN_OUT"]);
  });
});
