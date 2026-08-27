/**
 * The client half of ADR-001.
 *
 * The server refuses an approval without the single-use challenge issued with
 * the run view; this is the only code allowed to spend one, and it spends ONLY
 * from a trusted gesture. `event.isTrusted` is the load-bearing property here:
 * the browser sets it and script cannot, so an agent holding the user's own
 * session — able to call fetch, able to call click() — cannot produce one.
 *
 * What this file can and cannot claim: it is the HONEST CLIENT, not the
 * boundary. An agent can read the challenge from the same run view the
 * dashboard reads it from and POST directly, skipping this code entirely. What
 * the server-side gate then still guarantees is single use — the replay fails.
 * The residual limit is recorded in ADR-001 rather than implied away here.
 *
 * The negative controls are the whole test: a synthetic event must NOT approve,
 * and must not even reach the network.
 */
import { describe, expect, it, vi } from "vitest";
import { approveFromGesture, NO_CHALLENGE_MESSAGE, UNTRUSTED_MESSAGE } from "./trustedApprove.js";

const CHALLENGE = "c_abc123";

const okClient = () => ({
  post: vi.fn(
    async (_path: string, _body?: unknown, _headers?: Record<string, string>) => ({
      id: "r_1", status: "approved", pushCommands: [],
    }),
  ),
  get: vi.fn(),
  request: vi.fn(),
});

describe("approveFromGesture", () => {
  it("approves in ONE request when the gesture is trusted", async () => {
    const client = okClient();
    const result = await approveFromGesture(client as never, "r_1", { isTrusted: true }, CHALLENGE);
    expect(result.status).toBe("approved");
    // Exactly one call: there is no credential-vending round trip any more.
    // A second path here would be the old mint endpoint creeping back.
    expect(client.post.mock.calls.map((c) => c[0])).toEqual(["/runs/r_1/approve"]);
  });

  it("sends the run view's challenge on the approve request", async () => {
    const client = okClient();
    await approveFromGesture(client as never, "r_1", { isTrusted: true }, CHALLENGE);
    const call = client.post.mock.calls.find((c) => String(c[0]).endsWith("/approve"))!;
    expect(call[2]).toMatchObject({ "x-approval-challenge": CHALLENGE });
  });

  it("REFUSES a synthetic event — the case an agent can actually produce", async () => {
    const client = okClient();
    await expect(
      approveFromGesture(client as never, "r_1", { isTrusted: false }, CHALLENGE),
    ).rejects.toThrow(UNTRUSTED_MESSAGE);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("REFUSES when there is no event at all (a bare scripted call)", async () => {
    const client = okClient();
    await expect(
      approveFromGesture(client as never, "r_1", undefined, CHALLENGE),
    ).rejects.toThrow(UNTRUSTED_MESSAGE);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("REFUSES an object merely CLAIMING to be trusted via a string", async () => {
    const client = okClient();
    await expect(
      approveFromGesture(client as never, "r_1", { isTrusted: "true" } as never, CHALLENGE),
    ).rejects.toThrow(UNTRUSTED_MESSAGE);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("REFUSES when the run carries no challenge — it is not at the gate", async () => {
    const client = okClient();
    await expect(
      approveFromGesture(client as never, "r_1", { isTrusted: true }, undefined),
    ).rejects.toThrow(NO_CHALLENGE_MESSAGE);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("surfaces a server refusal rather than reporting success", async () => {
    const client = {
      post: vi.fn(async () => {
        throw new Error("403 human-approval-required");
      }),
      get: vi.fn(),
      request: vi.fn(),
    };
    await expect(
      approveFromGesture(client as never, "r_1", { isTrusted: true }, CHALLENGE),
    ).rejects.toThrow(/human-approval-required/);
  });
});
