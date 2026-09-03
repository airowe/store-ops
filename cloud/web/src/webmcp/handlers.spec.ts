/**
 * Handlers turn a tool call into an API call and its result into prose an agent
 * can relay. The properties that matter are the product's two invariants:
 * measured-or-nothing (never invent a number, say "—" or say nothing) and
 * approval-is-the-terminus (never describe anything as shipped).
 */
import { describe, expect, it, vi } from "vitest";
import { createHandlers, SHIPPED_WORDS } from "./handlers.js";

function fakeClient(routes: Record<string, unknown>) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const pick = (path: string) => {
    if (!(path in routes)) throw new Error(`unexpected path ${path}`);
    return routes[path];
  };
  return {
    calls,
    client: {
      get: async <T,>(path: string) => {
        calls.push({ method: "GET", path });
        return pick(path) as T;
      },
      post: async <T,>(path: string, body?: unknown) => {
        calls.push({ method: "POST", path, body });
        return pick(path) as T;
      },
      request: async <T,>(path: string, init: { method: string; body?: unknown }) => {
        calls.push({ method: init.method, path, body: init.body });
        return pick(path) as T;
      },
    },
  };
}

const RUN = {
  id: "r_1",
  app_id: "a_1",
  status: "awaiting_approval",
  currentCopy: { name: "Old Title", subtitle: "Old sub", keywords: "a,b" },
  result: {
    proposedCopy: { name: "New Title", subtitle: "New sub", keywords: "a,b,c" },
    findings: [{ severity: "warn", title: "Subtitle wastes 12 characters" }],
  },
};

describe("createHandlers", () => {
  it("whoami reports the signed-in account", async () => {
    const { client } = fakeClient({
      "/auth/me": { email: "person@example.com" },
      "/apps": { apps: [{ id: "a_1" }, { id: "a_2" }] },
      "/runs": { runs: [{ id: "r_1", status: "awaiting_approval" }] },
    });
    const h = createHandlers({ client: client as never });
    const text = await h.whoami!({});
    expect(text).toContain("person@example.com");
    expect(text).toContain("2");
  });

  it("whoami says so plainly when nobody is signed in", async () => {
    const { client } = fakeClient({ "/auth/me": {} });
    const h = createHandlers({ client: client as never });
    expect(await h.whoami!({})).toMatch(/nobody is signed in/i);
  });

  it("describe_boundary names the one thing an agent cannot do", async () => {
    const { client } = fakeClient({});
    const h = createHandlers({ client: client as never });
    const text = await h.describe_boundary!({});
    expect(text).toMatch(/approv/i);
    expect(text).toMatch(/cannot|only a person|human/i);
  });

  /**
   * The boundary text is the agent-facing CONTRACT: it is what a well-behaved
   * agent reads to decide what not to attempt. It drifted once already — it
   * described `requireApprovalNonce` ("a nonce minted by a real click, which a
   * script cannot produce") for as long as that function had been deleted, and
   * nothing caught it because the test above passes on any text mentioning
   * approval.
   *
   * These are negative controls on the specific claims that went stale. Each
   * one fails against the text that shipped.
   */
  it("does NOT claim a click mints anything — that mechanism was deleted", async () => {
    const { client } = fakeClient({});
    const h = createHandlers({ client: client as never });
    const text = await h.describe_boundary!({});
    // The deleted design, verbatim enough to catch its return.
    expect(text).not.toMatch(/nonce/i);
    expect(text).not.toMatch(/minted|mint/i);
  });

  it("does NOT claim a script is incapable of producing the credential", async () => {
    // The honest limit (approvalBoundary.ts): an agent in the page CAN read the
    // run view and therefore the challenge. Server-side nothing proves a human
    // clicked — `isTrusted` never crosses the network. Claiming otherwise tells
    // the one party that would test it a falsehood.
    const { client } = fakeClient({});
    const h = createHandlers({ client: client as never });
    const text = await h.describe_boundary!({});
    expect(text).not.toMatch(/script cannot|cannot be scripted|only a real click/i);
  });

  it("describes what IS enforced: a single-use challenge, spent server-side", async () => {
    const { client } = fakeClient({});
    const h = createHandlers({ client: client as never });
    const text = await h.describe_boundary!({});
    expect(text).toMatch(/single-use|single use/i);
    expect(text).toMatch(/challenge/i);
  });

  it("still separates approving from shipping", async () => {
    // Unchanged invariant — the rewrite must not drop it.
    const { client } = fakeClient({});
    const h = createHandlers({ client: client as never });
    const text = await h.describe_boundary!({});
    expect(text).toMatch(/not shipping|nothing reaches|separate/i);
  });

  it("get_run reports the proposal without claiming anything shipped", async () => {
    const { client } = fakeClient({ "/runs/r_1": RUN });
    const h = createHandlers({ client: client as never, runId: () => "r_1" });
    const text = (await h.get_run!({})).toLowerCase();
    for (const w of SHIPPED_WORDS) expect(text, `leaked "${w}"`).not.toContain(w);
    expect(text).toContain("new title");
  });

  it("get_run refuses to guess when there is no run in scope", async () => {
    const { client } = fakeClient({});
    const h = createHandlers({ client: client as never, runId: () => null });
    await expect(h.get_run!({})).rejects.toThrow(/no run/i);
  });

  it("list_pending_runs counts only what is at the gate", async () => {
    const { client } = fakeClient({
      "/runs": {
        runs: [
          { id: "r_1", status: "awaiting_approval", app_name: "One" },
          { id: "r_2", status: "detected", app_name: "Two" },
          { id: "r_3", status: "approved", app_name: "Three" },
        ],
      },
    });
    const h = createHandlers({ client: client as never });
    const text = await h.list_pending_runs!({});
    expect(text).toContain("r_1");
    expect(text).not.toContain("r_2");
    expect(text).not.toContain("r_3");
  });

  it("list_pending_runs says the queue is empty rather than inventing rows", async () => {
    const { client } = fakeClient({ "/runs": { runs: [] } });
    const h = createHandlers({ client: client as never });
    expect(await h.list_pending_runs!({})).toMatch(/no runs|nothing/i);
  });

  it("stage_for_approval sends the edit and reports the run still needs a person", async () => {
    const { client, calls } = fakeClient({
      "/runs/r_1": RUN,
      "/runs/r_1/edits": { id: "r_1", status: "awaiting_approval", staged: ["subtitle"], proposedCopy: { subtitle: "Third subtitle" }, note: "still awaiting approval" },
    });
    const h = createHandlers({ client: client as never, runId: () => "r_1" });
    const text = await h.stage_for_approval!({ subtitle: "Third subtitle" });
    expect(calls.some((c) => c.path === "/runs/r_1/edits")).toBe(true);
    expect(text).toMatch(/still|awaiting|approv/i);
    expect(text).toMatch(/stage receipt/i);
    expect(text).toMatch(/14\/30/);
    expect(text).toMatch(/agent draft/i);
  });

  it("stage_for_approval rejects an edit with no recognised copy field", async () => {
    const { client } = fakeClient({ "/runs/r_1": RUN });
    const h = createHandlers({ client: client as never, runId: () => "r_1" });
    await expect(h.stage_for_approval!({ nonsense: "x" })).rejects.toThrow(/title|subtitle|keywords/i);
  });

  it("set_schedule validates the cadence before calling the API", async () => {
    const { client, calls } = fakeClient({});
    const h = createHandlers({ client: client as never, appId: () => "a_1" });
    await expect(h.set_schedule!({ cadence: "hourly" })).rejects.toThrow(/daily|weekly|biweekly/i);
    expect(calls).toEqual([]);
  });

  it("set_schedule sends a valid cadence", async () => {
    const { client, calls } = fakeClient({
      // GET returns the CURRENT slot; the real server echoes back what it saved,
      // so the fake must too — otherwise this asserts nothing about the echo.
      "/apps/a_1/schedule": { schedule: { cadence: "daily", day: 1, hourUtc: 9 } },
    });
    const h = createHandlers({ client: client as never, appId: () => "a_1" });
    const text = await h.set_schedule!({ cadence: "daily", hourUtc: 9 });
    const post = calls.find((c) => c.method === "POST");
    expect(post!.body).toMatchObject({ cadence: "daily", hourUtc: 9 });
    expect(text).toMatch(/daily/i);
  });

  it("set_schedule keeps the app's existing slot when only the cadence is given", async () => {
    const { client, calls } = fakeClient({
      "/apps/a_1/schedule": { schedule: { cadence: "weekly", day: 4, hourUtc: 17 } },
    });
    const h = createHandlers({ client: client as never, appId: () => "a_1" });
    await h.set_schedule!({ cadence: "biweekly" });
    // "make it biweekly" must not silently move the hour to a default.
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({
      cadence: "biweekly",
      day: 4,
      hourUtc: 17,
    });
  });

  it("explain_run never describes a proposal as shipped", async () => {
    const { client } = fakeClient({ "/runs/r_1": { ...RUN, trigger: { reasons: ["a keyword fell"] } } });
    const h = createHandlers({ client: client as never, runId: () => "r_1" });
    const text = (await h.explain_run!({})).toLowerCase();
    for (const w of SHIPPED_WORDS) expect(text, `leaked "${w}"`).not.toContain(w);
  });

  it("exposes a handler for every tool that could be asked of it", async () => {
    const { client } = fakeClient({});
    const h = createHandlers({ client: client as never });
    const { MANIFEST } = await import("./manifest.js");
    for (const spec of MANIFEST) {
      expect(typeof h[spec.name], `no handler for ${spec.name}`).toBe("function");
    }
  });

  it("declares no handler that approves", async () => {
    const { client } = fakeClient({});
    const h = createHandlers({ client: client as never });
    for (const name of Object.keys(h)) {
      expect(name).not.toMatch(/^approve|^ship|^push|^publish/);
    }
  });
});
