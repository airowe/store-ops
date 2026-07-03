import * as SecureStore from "expo-secure-store";
import type { ApiClient } from "../api/client.js";
import type { Me } from "../types/api.js";
import {
  SESSION_TOKEN_KEY,
  boot,
  clearToken,
  exchangeMagicLink,
  extractMagicToken,
  getToken,
  setToken,
  signOut,
} from "./session.js";

/** A fake ApiClient that records calls and returns canned responses. */
function fakeClient(handlers: Partial<Record<string, unknown>> = {}): ApiClient & { calls: string[] } {
  const calls: string[] = [];
  const client = {
    calls,
    async request<T>(path: string) {
      calls.push(path);
      return handlers[path] as T;
    },
    get<T>(path: string) {
      return this.request<T>(path);
    },
    post<T>(path: string) {
      return this.request<T>(path);
    },
  };
  return client as unknown as ApiClient & { calls: string[] };
}

beforeEach(async () => {
  await clearToken();
  jest.clearAllMocks();
});

describe("token store", () => {
  it("set/get/clear round-trips through SecureStore (the only persisted secret)", async () => {
    expect(await getToken()).toBeNull();
    await setToken("sess-1");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(SESSION_TOKEN_KEY, "sess-1");
    expect(await getToken()).toBe("sess-1");
    await clearToken();
    expect(await getToken()).toBeNull();
  });
});

describe("boot", () => {
  it("with no token → unauthed WITHOUT hitting the network", async () => {
    const client = fakeClient();
    const res = await boot(client);
    expect(res).toEqual({ authed: false });
    expect(client.calls).toHaveLength(0);
  });

  it("with a token → calls /auth/me and returns its result", async () => {
    await setToken("sess-1");
    const meRes: Me = { authed: true, via: "session", email: "a@b.com" };
    const client = fakeClient({ "/auth/me": meRes });
    const res = await boot(client);
    expect(res).toEqual(meRes);
    expect(client.calls).toEqual(["/auth/me"]);
  });
});

describe("exchangeMagicLink", () => {
  it("posts the magic token and persists the returned session token", async () => {
    const client = fakeClient({ "/auth/exchange": { token: "sess-xyz", email: "a@b.com" } });
    const res = await exchangeMagicLink(client, "magic-123");
    expect(res.token).toBe("sess-xyz");
    expect(await getToken()).toBe("sess-xyz");
  });
});

describe("signOut", () => {
  it("drops the on-device token", async () => {
    await setToken("sess-1");
    await signOut();
    expect(await getToken()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_TOKEN_KEY);
  });
});

describe("extractMagicToken", () => {
  it("pulls token from a universal link", () => {
    expect(extractMagicToken("https://shipaso.com/auth/m?token=abc.def")).toBe("abc.def");
  });
  it("pulls token from a custom-scheme link", () => {
    expect(extractMagicToken("shipaso://auth/m?token=abc.def&x=1")).toBe("abc.def");
  });
  it("url-decodes the token", () => {
    expect(extractMagicToken("https://shipaso.com/auth/m?token=a%2Bb%3Dc")).toBe("a+b=c");
  });
  it("returns null when there is no token (non-auth deep link)", () => {
    expect(extractMagicToken("https://shipaso.com/apps/123")).toBeNull();
    expect(extractMagicToken(null)).toBeNull();
    expect(extractMagicToken(undefined)).toBeNull();
  });
  it("ignores a token param on a NON-auth path (scoped to /auth/m only)", () => {
    // A shared content link happening to carry ?token= must never fire an
    // auth exchange — that could strand the UI or consume a fresh session boot.
    expect(extractMagicToken("https://shipaso.com/apps/123?token=abc")).toBeNull();
    expect(extractMagicToken("shipaso://runs/r1?token=abc")).toBeNull();
  });
});
