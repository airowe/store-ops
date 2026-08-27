/**
 * The manifest is the page's public promise to an agent. These tests hold it to
 * the two invariants that make the entry defensible:
 *   • no tool crosses the approval gate (ADR-001), and
 *   • a tool that writes is never advertised as read-only.
 * Both are properties over the WHOLE manifest, so a tool added later cannot
 * quietly break them.
 */
import { describe, expect, it } from "vitest";
import { MANIFEST, toolsForRoute, GATE_CROSSING_VERBS } from "./manifest.js";

describe("manifest", () => {
  it("gives every tool a unique name", () => {
    const names = MANIFEST.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("declares no tool that approves, ships, pushes or publishes", () => {
    const offenders = MANIFEST.filter((t) =>
      GATE_CROSSING_VERBS.some((v) => t.name.toLowerCase().includes(v)),
    );
    expect(offenders.map((t) => t.name)).toEqual([]);
  });

  it("marks every writing tool as NOT read-only", () => {
    for (const t of MANIFEST.filter((t) => t.writes)) {
      expect(t.readOnly, `${t.name} writes but claims readOnly`).toBe(false);
    }
  });

  it("marks every read-only tool as non-writing", () => {
    for (const t of MANIFEST.filter((t) => t.readOnly)) {
      expect(t.writes, `${t.name} is readOnly but writes`).toBe(false);
    }
  });

  it("describes every tool in prose an agent can act on", () => {
    for (const t of MANIFEST) {
      expect(t.description.length, `${t.name} description too short`).toBeGreaterThan(30);
    }
  });

  it("scopes each tool to at least one route", () => {
    for (const t of MANIFEST) {
      expect(t.routes.length, `${t.name} is unreachable`).toBeGreaterThan(0);
    }
  });

  describe("toolsForRoute", () => {
    it("returns the global tools on every route", () => {
      const global = MANIFEST.filter((t) => t.routes.includes("*")).map((t) => t.name);
      expect(global.length).toBeGreaterThan(0);
      for (const path of ["/", "/runs", "/runs/abc", "/apps/xyz"]) {
        const names = toolsForRoute(path).map((t) => t.name);
        for (const g of global) expect(names, `${g} missing on ${path}`).toContain(g);
      }
    });

    it("offers the run-detail tools on /runs/:id but not on the landing page", () => {
      expect(toolsForRoute("/runs/r_1").map((t) => t.name)).toContain("draft_alternative");
      expect(toolsForRoute("/").map((t) => t.name)).not.toContain("draft_alternative");
    });

    it("distinguishes the run INDEX from a run DETAIL", () => {
      expect(toolsForRoute("/runs").map((t) => t.name)).toContain("list_pending_runs");
      expect(toolsForRoute("/runs").map((t) => t.name)).not.toContain("draft_alternative");
    });

    it("offers the app tools on /apps/:id", () => {
      const names = toolsForRoute("/apps/app_1").map((t) => t.name);
      expect(names).toContain("set_schedule");
      expect(names).toContain("trigger_run");
    });

    it("returns only global tools on an unknown route", () => {
      const names = toolsForRoute("/nothing-here").map((t) => t.name);
      expect(names).toEqual(MANIFEST.filter((t) => t.routes.includes("*")).map((t) => t.name));
    });
  });
});
