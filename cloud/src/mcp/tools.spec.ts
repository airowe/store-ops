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
        "audit_play_app",
        "audit_play_app_owner",
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

/** The ten chart neighbours the icon comparison compares against. */
const NEIGHBOUR_IDS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const MY_ARTWORK = "https://cdn.example/mine.png";

/**
 * A fetch stub carrying EVERY input the icon comparison needs: our own artwork,
 * a trackId, a genre, a full category chart, neighbour artwork, and fetchable
 * image bytes.
 *
 * Used by both icon tests on purpose. The flag-off test needs a fixture rich
 * enough that the FLAG is the only thing stopping the comparison — otherwise it
 * passes because the data is thin and would not notice the gate disappearing.
 */
function stubIconReadyFetch() {
  vi.stubGlobal("fetch", async (url: string, _init?: unknown) => {
    const u = String(url);
    // the neighbour artwork batch (comma-separated id list)
    if (u.includes("/lookup") && u.includes("id=")) {
      return new Response(
        JSON.stringify({
          resultCount: NEIGHBOUR_IDS.length,
          results: NEIGHBOUR_IDS.map((id) => ({
            trackId: Number(id),
            artworkUrl512: `https://cdn.example/${id}.png`,
          })),
        }),
        { status: 200 },
      );
    }
    if (u.includes("/lookup")) {
      return new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              bundleId: "com.acme.app",
              trackName: "Acme",
              trackId: 500,
              primaryGenreId: "6013",
              primaryGenreName: "Health & Fitness",
              artworkUrl512: MY_ARTWORK,
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (u.includes("/rss/")) {
      const entry = NEIGHBOUR_IDS.map((id) => ({ id: { attributes: { "im:id": id } } }));
      return new Response(JSON.stringify({ feed: { entry } }), { status: 200 });
    }
    if (u.startsWith("https://cdn.example/")) {
      // ours gets a 9, neighbours a 1 — so a model stub can tell them apart
      return new Response(new Uint8Array([u === MY_ARTWORK ? 9 : 1, 2, 3]), { status: 200 });
    }
    return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
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

  it("audit_app DELIVERS the measured chart rank as a finding, not just measures it", async () => {
    // The measurement is useless if the handler drops it on the way to
    // auditFindings — which is exactly what happened while `chartRank` had a
    // consumer and no producer. This pins the whole path: chart feed → runAgent
    // → handler → finding.
    const listing = {
      bundleId: "com.acme.app",
      trackName: "Acme",
      trackId: 555,
      primaryGenreId: "6013",
      primaryGenreName: "Health & Fitness",
    };
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.includes("/lookup")) {
        return new Response(JSON.stringify({ resultCount: 1, results: [listing] }), { status: 200 });
      }
      if (u.includes("/rss/")) {
        const entry = ["111", "555"].map((id) => ({ id: { attributes: { "im:id": id } } }));
        return new Response(JSON.stringify({ feed: { entry } }), { status: 200 });
      }
      return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
    });
    const out = (await toolByName("audit_app")!.handler({ bundleId: "com.acme.app" }, ctx)) as {
      findings: { id: string; title: string }[];
    };
    const chart = out.findings.filter((f) => f.id.startsWith("chart_rank"));
    expect(chart).toHaveLength(1);
    expect(chart[0]!.id).toBe("chart_rank_present");
    expect(chart[0]!.title).toContain("#2");
  });

  it("audit_app spends NOTHING on icons when ICON_VISION_ENABLED is off", async () => {
    // The default path must not touch the AI binding: this surface is the only
    // one that costs an inference per icon.
    //
    // The run is given EVERY other input the comparison needs — artwork, a
    // trackId, a genre, and a full chart — so the flag is the only thing
    // stopping it. Without that this test passes because the fixture is thin,
    // not because the gate works, and it would not notice the gate's removal.
    const run = vi.fn(async () => ({ response: '{"layout":"other","hasText":false}' }));
    stubIconReadyFetch();
    const withAi = { env: { DEFAULT_COUNTRY: "US", AI: { run } } as unknown as Env, user: ctx.user };
    const out = (await toolByName("audit_app")!.handler({ bundleId: "com.acme.app" }, withAi)) as {
      findings: { id: string }[];
    };
    expect(run).not.toHaveBeenCalled();
    expect(out.findings.some((f) => f.id.startsWith("icon_"))).toBe(false);
  });

  it("audit_app REACHES the icon comparison when the flag and binding are present", async () => {
    // Guards the failure this repo has hit twice: a module that exists, is
    // tested, and is never called. Ten conforming neighbours + a differing
    // icon of ours is the shape that must produce `icon_stands_apart`.
    const run = vi.fn(async (_m: string, input: unknown) => {
      const { image } = input as { image: number[] };
      // first byte marks ours (9) vs a neighbour (1) — see stubIconReadyFetch
      const layout = image[0] === 9 ? "other" : "single_centred_shape";
      return { response: `{"layout":"${layout}","hasText":false}` };
    });
    stubIconReadyFetch();
    const env = {
      DEFAULT_COUNTRY: "US",
      AI: { run },
      ICON_VISION_ENABLED: "1",
    } as unknown as Env;
    const out = (await toolByName("audit_app")!.handler({ bundleId: "com.acme.app" }, { env, user: ctx.user })) as {
      findings: { id: string; evidence?: string }[];
    };
    const icon = out.findings.filter((f) => f.id.startsWith("icon_"));
    expect(icon).toHaveLength(1);
    expect(icon[0]!.id).toBe("icon_stands_apart");
    expect(run).toHaveBeenCalled();
  }, 20_000);

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

  it("audit_play_app audits a Play package (no keyword field, honest locks)", async () => {
    const PLAY_PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@type": "SoftwareApplication",
      name: "Calm - Sleep & Meditation",
      description: "Guided meditation and sleep stories to help you relax.",
      applicationCategory: "HEALTH_AND_FITNESS",
      screenshot: ["https://play-lh.googleusercontent.com/s1"],
    })}</script></head></html>`;
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).includes("play.google.com")
        ? new Response(PLAY_PAGE, { status: 200 })
        : new Response("{}", { status: 200 }),
    );
    const out = (await toolByName("audit_play_app")!.handler(
      { query: "com.calm.android" },
      ctx,
    )) as Record<string, unknown>;
    expect(out.listing).toBeDefined();
    expect((out.listing as Record<string, unknown>).keywordField).toBeNull(); // Play has none
    expect(Array.isArray(out.findings)).toBe(true);
    expect(out.summary).toBeDefined();
  });

  it("audit_play_app rejects a free-text name (Play has no public name search)", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    await expect(
      toolByName("audit_play_app")!.handler({ query: "meditation app" }, ctx),
    ).rejects.toThrow(/no public name search|No Google Play app/i);
  });

  it("audit_play_app_owner errors clearly when no service account is configured", async () => {
    // ctx.env has no GOOGLE_PLAY_SERVICE_ACCOUNT → honest "not connected" error.
    await expect(
      toolByName("audit_play_app_owner")!.handler({ packageName: "com.calm.android" }, ctx),
    ).rejects.toThrow(/not connected|GOOGLE_PLAY_SERVICE_ACCOUNT/);
  });

  it("audit_play_app_owner errors on a malformed service-account secret", async () => {
    const badCtx: ToolContext = {
      env: { DEFAULT_COUNTRY: "US", GOOGLE_PLAY_SERVICE_ACCOUNT: "not json" } as unknown as Env,
      user: { id: "u1", email: "dev@example.com" },
    };
    await expect(
      toolByName("audit_play_app_owner")!.handler({ packageName: "com.calm.android" }, badCtx),
    ).rejects.toThrow(/not valid JSON/);
  });
});
