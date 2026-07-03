/**
 * Push module — pure message construction + best-effort send, all with an
 * injected fetch (zero network). Asserts the honesty/robustness contract: invalid
 * tokens are dropped, a delivery failure is swallowed (never throws), and the
 * deep-link payload points at the run.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildRunReadyMessages,
  isExpoPushToken,
  notifyRunAwaitingApproval,
  sendExpoPush,
  type PushFetch,
} from "./push.js";

const T1 = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const T2 = "ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

describe("isExpoPushToken", () => {
  it("accepts Exponent/Expo push tokens, rejects junk", () => {
    expect(isExpoPushToken(T1)).toBe(true);
    expect(isExpoPushToken(T2)).toBe(true);
    expect(isExpoPushToken("not-a-token")).toBe(false);
    expect(isExpoPushToken("")).toBe(false);
    expect(isExpoPushToken("ExpoPushToken[]")).toBe(false);
  });
});

describe("buildRunReadyMessages", () => {
  it("one message per VALID token, with the run deep-link payload", () => {
    const msgs = buildRunReadyMessages([T1, "garbage", T2], { appName: "Acme", runId: "run9" });
    expect(msgs).toHaveLength(2); // garbage dropped
    expect(msgs[0]!.to).toBe(T1);
    expect(msgs[0]!.title).toContain("Acme");
    expect(msgs[0]!.data).toEqual({ runId: "run9", url: "/runs/run9" });
  });

  it("uses the fix label in the body when provided", () => {
    const [m] = buildRunReadyMessages([T1], { appName: "Acme", runId: "r", fixLabel: "3 fixes available" });
    expect(m!.body).toContain("3 fixes available");
  });
});

describe("sendExpoPush", () => {
  it("POSTs the batch and counts accepted messages", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetch: PushFetch = async (url, init) => {
      calls.push({ url, body: init.body });
      return { ok: true, status: 200 };
    };
    const n = await sendExpoPush(fetch, buildRunReadyMessages([T1, T2], { appName: "A", runId: "r" }), {
      endpoint: "https://push.test/send",
    });
    expect(n).toBe(2);
    expect(calls[0]!.url).toBe("https://push.test/send");
    expect(JSON.parse(calls[0]!.body)).toHaveLength(2);
  });

  it("chunks to 100 per request", async () => {
    let requests = 0;
    const fetch: PushFetch = async () => {
      requests++;
      return { ok: true, status: 200 };
    };
    const tokens = Array.from({ length: 250 }, (_, i) => `ExpoPushToken[${String(i).padStart(6, "0")}]`);
    const n = await sendExpoPush(fetch, buildRunReadyMessages(tokens, { appName: "A", runId: "r" }));
    expect(requests).toBe(3); // 100 + 100 + 50
    expect(n).toBe(250);
  });

  it("swallows a transport failure (best-effort — never throws)", async () => {
    const fetch: PushFetch = async () => {
      throw new Error("egress blocked");
    };
    await expect(sendExpoPush(fetch, buildRunReadyMessages([T1], { appName: "A", runId: "r" }))).resolves.toBe(0);
  });

  it("counts 0 on a non-ok response but does not throw", async () => {
    const fetch: PushFetch = async () => ({ ok: false, status: 400 });
    await expect(sendExpoPush(fetch, buildRunReadyMessages([T1], { appName: "A", runId: "r" }))).resolves.toBe(0);
  });
});

/** Minimal fake D1 returning canned tokens for the notify test. */
function fakeDb(tokensByUser: Record<string, string[]>) {
  return {
    prepare(_sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          bound = a;
          return stmt;
        },
        async all<T>() {
          const uid = String(bound[0]);
          return { results: (tokensByUser[uid] ?? []).map((token) => ({ token })) as T[] };
        },
        async first() {
          return null;
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

describe("notifyRunAwaitingApproval", () => {
  const app = { user_id: "u1", name: "Acme", bundle_id: "com.acme" };

  it("no registered devices → no-op (0), no send attempted", async () => {
    const fetch = vi.fn<PushFetch>(async () => ({ ok: true, status: 200 }));
    const n = await notifyRunAwaitingApproval(fetch, fakeDb({}), app, "run1");
    expect(n).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("with devices → sends and returns the accepted count", async () => {
    const fetch = vi.fn<PushFetch>(async () => ({ ok: true, status: 200 }));
    const n = await notifyRunAwaitingApproval(fetch, fakeDb({ u1: [T1, T2] }), app, "run1", {
      endpoint: "https://push.test/send",
    });
    expect(n).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
