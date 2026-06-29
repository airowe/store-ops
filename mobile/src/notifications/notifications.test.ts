import type { ApiClient } from "../api/client.js";
import { registerForPush, type PushDeps } from "./register.js";
import { handleNotificationResponse, targetForResponse } from "./handlers.js";

function client(onPost?: (p: string, b: unknown) => void): ApiClient {
  const call = async <T,>(p: string, b?: unknown) => {
    onPost?.(p, b);
    return {} as T;
  };
  return { get: call, post: call, request: call } as unknown as ApiClient;
}

function deps(status: string): PushDeps {
  return {
    getPermissionsAsync: async () => ({ status: "undetermined" }),
    requestPermissionsAsync: async () => ({ status }),
    getExpoPushTokenAsync: async () => ({ data: "ExpoPushToken[abc]" }),
  };
}

describe("registerForPush", () => {
  it("granted → returns the token and posts it to the server", async () => {
    const posts: Array<{ p: string; b: unknown }> = [];
    const res = await registerForPush(client((p, b) => posts.push({ p, b })), deps("granted"));
    expect(res).toEqual({ ok: true, token: "ExpoPushToken[abc]" });
    expect(posts[0]).toEqual({ p: "/account/push-token", b: { token: "ExpoPushToken[abc]" } });
  });

  it("denied → feature simply off (no error, no token)", async () => {
    const res = await registerForPush(client(), deps("denied"));
    expect(res).toEqual({ ok: false, reason: "denied" });
  });

  it("a missing server endpoint is a best-effort no-op (still ok with token)", async () => {
    const failing = {
      get: async () => ({}),
      request: async () => ({}),
      post: async () => {
        throw new Error("404");
      },
    } as unknown as ApiClient;
    const res = await registerForPush(failing, deps("granted"));
    expect(res).toEqual({ ok: true, token: "ExpoPushToken[abc]" });
  });
});

describe("notification tap", () => {
  it("resolves the route from the payload and navigates", () => {
    const nav = jest.fn();
    handleNotificationResponse(
      { notification: { request: { content: { data: { runId: "r9" } } } } },
      nav,
    );
    expect(nav).toHaveBeenCalledWith("/(app)/runs/r9");
  });

  it("a payload with no target does not navigate", () => {
    const nav = jest.fn();
    handleNotificationResponse({ notification: { request: { content: { data: {} } } } }, nav);
    expect(nav).not.toHaveBeenCalled();
    expect(targetForResponse({ notification: { request: { content: {} } } })).toBeNull();
  });
});
