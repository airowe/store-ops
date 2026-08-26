/**
 * The approval boundary (ADR-001). These tests are the executable statement of
 * the guarantee the WebMCP entry claims: no agent-held credential can cross the
 * human approval gate, by either the single or the bulk route.
 */
import { describe, expect, it } from "vitest";
import { mintApprovalNonce, mintSessionToken } from "../auth.js";
import { requireApprovalNonce, requireHumanSession } from "./approvalBoundary.js";

describe("requireHumanSession — bulk approve is cookie-only", () => {
  it("ALLOWS a cookie session (the dashboard, unchanged)", () => {
    expect(requireHumanSession("cookie")).toEqual({ ok: true });
  });

  it("REFUSES a bearer credential — an API key must not bulk-approve", () => {
    const v = requireHumanSession("bearer");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(403);
  });

  it("REFUSES the demo-env header — weaker than a cookie, not stronger", () => {
    const v = requireHumanSession("demo-header");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(403);
  });

  it("explains WHY, so a refused agent can tell the human what to do", () => {
    const v = requireHumanSession("bearer");
    if (!v.ok) expect(v.error).toMatch(/human|browser|sign|session/i);
  });
});

describe("requireApprovalNonce — single approve needs a trusted gesture", () => {
  const SECRET = "test-secret-please-ignore";
  const RUN = "9f8e7d6c-1234-4a5b-8c9d-0123456789ab";
  const USER = { id: "u1", email: "user@example.com", auth: "cookie" as const };
  const env = { SESSION_SECRET: SECRET, APP_ENV: "test" };
  const reqWith = (nonce?: string) =>
    new Request("https://api.test/runs/x/approve", {
      method: "POST",
      headers: nonce ? { "x-approval-nonce": nonce } : {},
    });

  it("ALLOWS a valid nonce for this run", async () => {
    const nonce = await mintApprovalNonce(SECRET, USER.email, RUN);
    await expect(requireApprovalNonce(reqWith(nonce), env, USER, RUN)).resolves.toEqual({ ok: true });
  });

  it("REFUSES when the header is absent — the agent-with-a-session case", async () => {
    const v = await requireApprovalNonce(reqWith(), env, USER, RUN);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(403);
  });

  it("REFUSES a nonce minted for a DIFFERENT run", async () => {
    const other = await mintApprovalNonce(SECRET, USER.email, "00000000-1111-4222-8333-444444444444");
    const v = await requireApprovalNonce(reqWith(other), env, USER, RUN);
    expect(v.ok).toBe(false);
  });

  it("REFUSES a nonce minted for a DIFFERENT user", async () => {
    const other = await mintApprovalNonce(SECRET, "attacker@example.com", RUN);
    const v = await requireApprovalNonce(reqWith(other), env, USER, RUN);
    expect(v.ok).toBe(false);
  });

  it("REFUSES the caller's own session token replayed as a nonce", async () => {
    const session = await mintSessionToken(SECRET, USER.email, { ttlSeconds: 3600 });
    const v = await requireApprovalNonce(reqWith(session), env, USER, RUN);
    expect(v.ok).toBe(false);
  });

  it("REFUSES junk", async () => {
    for (const junk of ["", "not-a-nonce", "a.b.c"]) {
      const v = await requireApprovalNonce(reqWith(junk), env, USER, RUN);
      expect(v.ok).toBe(false);
    }
  });
});
