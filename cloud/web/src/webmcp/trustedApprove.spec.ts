/**
 * The client half of ADR-001.
 *
 * The server refuses an approval without a nonce; this is the only code allowed
 * to mint one, and it mints ONLY from a trusted gesture. `event.isTrusted` is
 * the load-bearing property: it is set by the browser and unforgeable by script,
 * so an agent holding the user's own session — able to call fetch, able to call
 * click() — still cannot produce one.
 *
 * The negative controls are the whole test: a synthetic event must NOT mint.
 */
import { describe, expect, it, vi } from "vitest";
import { approveFromGesture, UNTRUSTED_MESSAGE } from "./trustedApprove.js";

const okClient = () => ({
  post: vi.fn(async (path: string, _body?: unknown, _headers?: Record<string, string>) =>
    path.endsWith("/approval-nonce")
      ? { nonce: "n_1", expiresInSeconds: 60 }
      : { id: "r_1", status: "approved", pushCommands: [] },
  ),
  get: vi.fn(),
  request: vi.fn(),
});

describe("approveFromGesture", () => {
  it("mints a nonce and approves when the gesture is trusted", async () => {
    const client = okClient();
    const result = await approveFromGesture(client as never, "r_1", { isTrusted: true });
    expect(result.status).toBe("approved");
    const paths = client.post.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(["/runs/r_1/approval-nonce", "/runs/r_1/approve"]);
  });

  it("sends the minted nonce on the approve request", async () => {
    const client = okClient();
    await approveFromGesture(client as never, "r_1", { isTrusted: true });
    const approveCall = client.post.mock.calls.find((c) => String(c[0]).endsWith("/approve"))!;
    expect(approveCall[2]).toMatchObject({ "x-approval-nonce": "n_1" });
  });

  it("REFUSES a synthetic event — the case an agent can actually produce", async () => {
    const client = okClient();
    await expect(approveFromGesture(client as never, "r_1", { isTrusted: false })).rejects.toThrow(
      UNTRUSTED_MESSAGE,
    );
    // Decisive: it must not even ASK for a nonce.
    expect(client.post).not.toHaveBeenCalled();
  });

  it("REFUSES when there is no event at all (a bare scripted call)", async () => {
    const client = okClient();
    await expect(approveFromGesture(client as never, "r_1", undefined)).rejects.toThrow(
      UNTRUSTED_MESSAGE,
    );
    expect(client.post).not.toHaveBeenCalled();
  });

  it("REFUSES an object merely CLAIMING to be trusted via a string", async () => {
    const client = okClient();
    await expect(
      approveFromGesture(client as never, "r_1", { isTrusted: "true" } as never),
    ).rejects.toThrow(UNTRUSTED_MESSAGE);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("does not approve when minting fails", async () => {
    const client = {
      post: vi.fn(async () => {
        throw new Error("mint refused");
      }),
      get: vi.fn(),
      request: vi.fn(),
    };
    await expect(approveFromGesture(client as never, "r_1", { isTrusted: true })).rejects.toThrow(
      /mint refused/,
    );
    expect(client.post).toHaveBeenCalledTimes(1);
  });
});
