import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * POST /runs/:id/goldie-config (#406 / #521) — the diagnosis half as a file
 * the developer drops into their app repo. Owner-only; plans with the
 * deterministic planner when there is no AI binding; never renders, never
 * uploads.
 */

let owner = "u1";
let trace: Record<string, unknown> = {};

vi.mock("../d1.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getRun: async (_db: unknown, id: string) =>
      id === "run-1" ? { id: "run-1", app_id: "app-1", status: "approved", created_at: "2026-09-01T00:00:00Z", reasoning_json: JSON.stringify(trace) } : null,
    getApp: async () => ({ id: "app-1", user_id: owner, bundle_id: "app.airowe.clarity", name: "Heathen", country: "DE" }),
  };
});

const { handleApi } = await import("./index.js");

function fakeDb() {
  const user = { id: "u1", email: "u@e.com", created_at: "2026-01-01", tier: "startup", status: "active" };
  const stmt = {
    bind: () => stmt,
    first: async () => user,
    run: async () => ({ success: true, meta: { changes: 1 } }),
    all: async () => ({ results: [] }),
  };
  return { prepare: () => stmt } as never;
}

const env = { APP_ENV: "demo", DB: fakeDb() };

const post = (b: unknown, runId = "run-1") =>
  handleApi(
    new Request(`https://api.test/runs/${runId}/goldie-config`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-email": "u@e.com" },
      body: JSON.stringify(b),
    }),
    env as never,
    {} as never,
  );

type Body = {
  config: { locales: string[]; scenes: Array<{ id: string; flow: string; headline: Record<string, string> }>; skipped: unknown[]; store: { subtitle: Record<string, string> }; degraded: boolean };
  file: string;
};

beforeEach(() => {
  owner = "u1";
  trace = {
    audit: { screenshots: { grade: "C", findings: ["Only 2 screenshots"], iphoneCount: 2, ipadCount: 0, score: 55 } },
    proposedCopy: { name: "Heathen", subtitle: "Secular meditation", keywords: "meditation,secular,calm", validation: { pass: true } },
    currentCopy: { name: "Heathen", subtitle: "Meditation", description: "Meditation without the spiritual layer." },
    localizedCopy: { "fr-FR": { name: "Heathen", subtitle: "Méditation laïque", keywords: "x", label: "draft — machine-translated, review before shipping" } },
    findings: [{ id: "screenshots_thin", title: "Only 2 screenshots", severity: "warn", impact: "conversion", surface: "screenshots", detail: "d", fix: "f" }],
  };
});

describe("POST /runs/:id/goldie-config", () => {
  it("emits a config with one scene per captured screen, the storefront locale first, and the file text", async () => {
    const res = await post({ rawScreens: ["home", "streak", "library"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.config.locales[0]).toBe("de-DE");
    expect(body.config.locales).toContain("fr-FR");
    expect(body.config.scenes.length).toBeGreaterThan(0);
    for (const s of body.config.scenes) expect(["home", "streak", "library"]).toContain(s.id);
    expect(body.config.store.subtitle["de-DE"]).toBe("Secular meditation");
    expect(body.config.store.subtitle["fr-FR"]).toBe("Méditation laïque");
    expect(body.config.degraded).toBe(true); // no AI binding in this env → deterministic planner, said so
    expect(body.file).toContain("export default config;");
    expect(body.file).toContain('bundleId: "app.airowe.clarity"');
    expect(body.file).toContain("run-1");
  });

  it("400s without captured screen ids — a plan with nothing to source is not a plan", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ rawScreens: [] })).status).toBe(400);
  });

  it("404s a run the caller does not own, and an unknown run", async () => {
    owner = "someone-else";
    expect((await post({ rawScreens: ["home"] })).status).toBe(404);
    owner = "u1";
    expect((await post({ rawScreens: ["home"] }, "nope")).status).toBe(404);
  });

  it("401s without a user", async () => {
    const res = await handleApi(
      new Request("https://api.test/runs/run-1/goldie-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rawScreens: ["home"] }),
      }),
      env as never,
      {} as never,
    );
    expect(res.status).toBe(401);
  });

  it("never invents a rating or age rating in the file", async () => {
    const body = (await (await post({ rawScreens: ["home"] })).json()) as Body;
    expect(body.file).not.toMatch(/rating:/);
    expect(body.file).not.toMatch(/ageRating/);
  });
});
