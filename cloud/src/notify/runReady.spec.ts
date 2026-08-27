/**
 * The run_ready notification composer. PURE — no DB, no transport — so what we
 * SAY can be tested apart from where we send it.
 *
 * Two project invariants are on trial here (CLAUDE.md):
 *   1. Measured-or-nothing — a count we did not measure is absent, never 0 and
 *      never a placeholder.
 *   2. Approval is the terminus — nothing may imply ShipASO ships anything, and
 *      "approved" must never be phrased as "shipped".
 */
import { describe, expect, it } from "vitest";
import { composeRunReady } from "./runReady.js";

const BASE = {
  appName: "Moonly",
  runId: "9f8e7d6c-1234-4a5b-8c9d-0123456789ab",
  dashboardUrl: "https://app.shipaso.com",
};

describe("composeRunReady", () => {
  it("names the app and links to the run", () => {
    const n = composeRunReady({ ...BASE, changedFields: ["subtitle", "keywords"] });
    expect(n.kind).toBe("run_ready");
    expect(n.title).toContain("Moonly");
    expect(n.url).toBe(`https://app.shipaso.com/runs/${BASE.runId}`);
  });

  it("counts only the fields it was actually given (measured-or-nothing)", () => {
    const n = composeRunReady({ ...BASE, changedFields: ["subtitle", "keywords"] });
    expect(n.title).toContain("2");
    expect(n.lines).toHaveLength(2);
  });

  it("says NOTHING about a count when no fields are known — never 0, never a placeholder", () => {
    const n = composeRunReady({ ...BASE, changedFields: [] });
    expect(n.title).not.toMatch(/\b0\b/);
    expect(n.body).not.toMatch(/\b0\b/);
    expect(n.title).toContain("Moonly");
    // still actionable: the human is told there is something at the gate
    expect(n.url).toBeTruthy();
  });

  it("never claims anything shipped or will ship (approval is the terminus)", () => {
    for (const fields of [[], ["subtitle"], ["name", "subtitle", "keywords", "promo"]]) {
      const n = composeRunReady({ ...BASE, changedFields: fields });
      const all = `${n.title} ${n.body} ${(n.lines ?? []).join(" ")}`.toLowerCase();
      expect(all).not.toMatch(/\bshipped\b|\bpushed\b|\bpublished\b|\blive now\b/);
      expect(all).not.toMatch(/we (?:will )?(?:ship|push|publish)/);
    }
  });

  it("asks for a decision — the notification exists to bring a human back", () => {
    const n = composeRunReady({ ...BASE, changedFields: ["subtitle"] });
    expect(`${n.title} ${n.body}`.toLowerCase()).toMatch(/approv|review|decide|waiting|gate/);
  });

  it("body stands alone for a lean channel (SMS gets no lines and no url)", () => {
    const n = composeRunReady({ ...BASE, changedFields: ["subtitle"] });
    expect(n.body.length).toBeGreaterThan(0);
    expect(n.body).not.toContain("http");
    expect(n.body).toContain("Moonly");
  });

  it("trims a trailing slash on the dashboard url rather than doubling it", () => {
    const n = composeRunReady({
      ...BASE,
      dashboardUrl: "https://app.shipaso.com/",
      changedFields: ["subtitle"],
    });
    expect(n.url).toBe(`https://app.shipaso.com/runs/${BASE.runId}`);
  });
});
