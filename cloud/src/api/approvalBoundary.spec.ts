/**
 * The approval boundary (ADR-001). These tests are the executable statement of
 * the guarantee the WebMCP entry claims: no agent-held credential can cross the
 * human approval gate, by either the single or the bulk route.
 */
import { describe, expect, it } from "vitest";
import { requireApprovalChallenge, requireHumanSession } from "./approvalBoundary.js";

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

/**
 * The challenge gate, over a stub DB whose only job is to record what was
 * asked and answer yes or no. The real single-use behaviour is proven against
 * actual SQLite in d1.approvalChallenges.spec.ts; what matters here is that the
 * POLICY refuses when the consume says no, and refuses BEFORE touching the
 * database when nothing was presented at all.
 */
describe("requireApprovalChallenge — approving spends a single-use challenge", () => {
  const RUN = "9f8e7d6c-1234-4a5b-8c9d-0123456789ab";
  const USER = { id: "u1" };

  function envWith(accepts: boolean) {
    const seen: unknown[] = [];
    const DB = {
      prepare: () => ({
        bind: (...a: unknown[]) => {
          seen.push(a);
          return { run: async () => ({ success: true, meta: { changes: accepts ? 1 : 0 } }) };
        },
      }),
    } as unknown as D1Database;
    return { env: { DB }, seen };
  }

  it("ALLOWS when the challenge spends", async () => {
    const { env } = envWith(true);
    await expect(
      requireApprovalChallenge(env, USER, RUN, { challenge: "good" }),
    ).resolves.toEqual({ ok: true });
  });

  it("REFUSES 403 when the challenge does not spend (replayed, expired, unknown)", async () => {
    const { env } = envWith(false);
    const v = await requireApprovalChallenge(env, USER, RUN, { challenge: "spent" });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.status).toBe(403);
      expect(v.boundary).toBe("human-approval-required");
    }
  });

  it("REFUSES a missing header without touching the database", async () => {
    const { env, seen } = envWith(true);
    const v = await requireApprovalChallenge(env, USER, RUN, { challenge: null });
    expect(v.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("REFUSES whitespace — an empty string must never match a blank row", async () => {
    const { env, seen } = envWith(true);
    const v = await requireApprovalChallenge(env, USER, RUN, { challenge: "   " });
    expect(v.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("never offers a gate-crossing capability in its refusal", async () => {
    const { env } = envWith(false);
    const v = await requireApprovalChallenge(env, USER, RUN, { challenge: "x" });
    if (!v.ok) {
      for (const c of v.youCan) {
        expect(c).not.toMatch(/approve|ship|push|publish|submit/i);
      }
    }
  });
});
