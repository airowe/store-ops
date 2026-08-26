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

/**
 * Structured refusals — the boundary explaining itself to a machine.
 *
 * A human never sees this body; the UI renders its own message. This is for
 * whoever hit the endpoint directly, which by definition is a script or an
 * agent. Telling it what it CAN do turns a dead end into a handoff.
 *
 * THE RULE THIS MUST NOT BREAK (ADR-001): a caller's self-description may
 * change what we TELL them, never what we PERMIT. Nothing here grants anything.
 */
describe("refusal bodies are machine-actionable", () => {
  const RUN = "9f8e7d6c-1234-4a5b-8c9d-0123456789ab";
  const USER = { id: "u1", email: "user@example.com", auth: "cookie" as const };
  const env = { SESSION_SECRET: "test-secret-please-ignore", APP_ENV: "test" };

  it("names the boundary with a STABLE machine code, not just prose", async () => {
    const v = await requireApprovalNonce(
      new Request("https://api.test/runs/x/approve", { method: "POST" }),
      env,
      USER,
      RUN,
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.boundary).toBe("human-approval-required");
  });

  it("tells the caller what it CAN do instead of only what it cannot", async () => {
    const v = await requireApprovalNonce(
      new Request("https://api.test/runs/x/approve", { method: "POST" }),
      env,
      USER,
      RUN,
    );
    if (!v.ok) {
      expect(v.youCan).toEqual(expect.arrayContaining(["explain_run", "draft_alternative"]));
      expect(v.humanMustDo).toMatch(/approv/i);
    }
  });

  it("never lists a capability that would cross the gate", async () => {
    const v = await requireApprovalNonce(
      new Request("https://api.test/runs/x/approve", { method: "POST" }),
      env,
      USER,
      RUN,
    );
    if (!v.ok) {
      for (const cap of v.youCan ?? []) {
        expect(cap).not.toMatch(/approve|ship|push|publish/i);
      }
    }
  });

  it("bulk refusal is structured too, and points at the per-run path", () => {
    const v = requireHumanSession("bearer");
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.boundary).toBe("human-approval-required");
      expect(v.humanMustDo).toBeTruthy();
    }
  });

  it("keeps the human-readable message — a person reading logs still gets prose", () => {
    const v = requireHumanSession("bearer");
    if (!v.ok) expect(v.error.length).toBeGreaterThan(40);
  });
});
