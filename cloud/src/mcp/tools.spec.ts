import { afterEach, describe, expect, it, vi } from "vitest";
import { TOOLS, toolByName, type ToolContext } from "./tools.js";
import type { Env } from "../index.js";

// ── the safety invariant the PRD calls out: ZERO mutating tools ──────────────────

describe("MCP tool registry — read-or-draft only (PRD #93 safety invariant)", () => {
  it("registers every tool as readOnly: true (no mutating tool can exist)", () => {
    expect(TOOLS.length).toBeGreaterThan(0);
    for (const t of TOOLS) {
      expect(t.readOnly).toBe(true);
    }
  });

  it("contains no tool whose name implies a write / push / persist", () => {
    // The store-push step is human-gated by design (#34 never-auto-build). If a
    // mutating tool ever sneaks in, this fails loudly.
    const mutating = /(push|write|publish|persist|approve|reject|delete|create|update|connect|disconnect|secret)/i;
    for (const t of TOOLS) {
      expect(t.name, `tool "${t.name}" name implies mutation`).not.toMatch(mutating);
    }
  });

  it("exposes the PRD's launch tool set, each with a description + input schema", () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "audit_app",
        "competitor_watch",
        "keyword_gaps",
        "localization_gaps",
        "preview_app",
        "propose_copy",
        "proof",
        "rank_check",
        "screenshot_coverage",
        "war_room",
      ].sort(),
    );
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(typeof t.inputSchema).toBe("object");
      expect(typeof t.handler).toBe("function");
    }
  });

  it("has unique tool names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ── behavioral delegation: handlers call the real engine fns ─────────────────────

function stubGlobalFetch(opts: { search?: unknown[] } = {}) {
  const listing = { bundleId: "com.acme.app", trackName: "Acme — Habit Tracker", description: "Build better habits." };
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).includes("/lookup")) {
      return new Response(JSON.stringify({ resultCount: 1, results: [listing] }), { status: 200 });
    }
    const results = opts.search ?? [];
    return new Response(JSON.stringify({ resultCount: results.length, results }), { status: 200 });
  });
}

// A minimal env: no TinyFish key → fetchForEnv falls back to the (stubbed) global
// fetch; no AI binding → the deterministic keyword classifier. No DB needed for
// the resolve-driven tools exercised here.
const ctx: ToolContext = {
  env: { DEFAULT_COUNTRY: "US" } as unknown as Env,
  user: { id: "u1", email: "dev@example.com" },
};

describe("MCP tool handlers — delegate to the real engine pass", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preview_app returns a teaser-safe preview (delegates to buildPreview)", async () => {
    stubGlobalFetch();
    const out = (await toolByName("preview_app")!.handler({ bundleId: "com.acme.app" }, ctx)) as Record<string, unknown>;
    expect(out.appName).toContain("Acme");
    expect("proposedCopy" in out).toBe(false); // teaser only
  });

  it("audit_app returns audit + scored findings + summary", async () => {
    stubGlobalFetch();
    const out = (await toolByName("audit_app")!.handler({ bundleId: "com.acme.app" }, ctx)) as Record<string, unknown>;
    expect(out.audit).toBeDefined();
    expect(Array.isArray(out.findings)).toBe(true);
    expect(out.summary).toBeDefined();
  });

  it("propose_copy returns a DRAFT only — no push commands reachable", async () => {
    stubGlobalFetch();
    const out = (await toolByName("propose_copy")!.handler({ bundleId: "com.acme.app" }, ctx)) as Record<string, unknown>;
    expect(out.draft).toBeDefined();
    expect(typeof out.note).toBe("string");
    // The draft path must never hand back executable push commands.
    expect("pushCommands" in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain("pushCommands");
  });

  it("resolution failure surfaces an actionable error (no silent wrong-app run)", async () => {
    stubGlobalFetch({ search: [] });
    await expect(
      toolByName("preview_app")!.handler({ query: "zzzznotanapp" }, ctx),
    ).rejects.toThrow(/No app found/);
  });
});
