import { describe, it, expect } from "vitest";
import type { AppListItem } from "@shipaso/api";
import { greeting, kpis, heroApp, pendingCount } from "./dashboardModel.js";

const app = (over: Partial<AppListItem> = {}): AppListItem => ({
  id: "a" + Math.round(over.id ? 0 : 1),
  name: "App",
  bundle_id: "com.x.app",
  latest_run: null,
  rank_summary: null,
  findings_summary: null,
  ...over,
});

const awaiting = (id: string, rank: number | null = null): AppListItem =>
  app({ id, latest_run: { status: "awaiting_approval", created_at: "2026-07-01T00:00:00Z" }, rank_summary: rank == null ? null : { lead_keyword: "kw", lead_rank: rank } });

const ranked = (id: string, rank: number): AppListItem =>
  app({ id, rank_summary: { lead_keyword: "kw", lead_rank: rank } });

describe("dashboardModel", () => {
  describe("greeting", () => {
    it("is calm when nothing awaits approval", () => {
      const g = greeting([ranked("a", 4)]);
      expect(g.urgent).toBe(false);
      expect(g.headline).toMatch(/nothing needs your approval/i);
    });
    it("names a single waiting app in the singular", () => {
      const g = greeting([awaiting("a")]);
      expect(g.eyebrow).toBe("1 run needs your approval");
      expect(g.headline).toMatch(/one app is waiting/i);
      expect(g.urgent).toBe(true);
    });
    it("counts multiple waiting apps as a word", () => {
      const g = greeting([awaiting("a"), awaiting("b")]);
      expect(g.eyebrow).toBe("2 runs need your approval");
      expect(g.headline).toMatch(/^Two apps are waiting/);
    });
  });

  describe("kpis", () => {
    it("counts only MEASURED lead ranks in the top 10 — never a null", () => {
      const k = kpis([ranked("a", 4), ranked("b", 12), awaiting("c", null)]);
      const top10 = k.find((x) => x.label === "In top 10")!;
      expect(top10.value).toBe("1"); // only rank 4 is ≤10; null is not counted
      expect(top10.sub).toBe("of 3 tracked");
    });
    it("shows the best measured lead rank, or '—' when nothing is measured", () => {
      expect(kpis([ranked("a", 9), ranked("b", 4)]).find((x) => x.label === "Best lead rank")!.value).toBe("#4");
      const none = kpis([awaiting("a", null)]).find((x) => x.label === "Best lead rank")!;
      expect(none.value).toBe("—");
      expect(none.sub).toMatch(/none measured/i);
    });
    it("reports the honest tracked-app count", () => {
      expect(kpis([app(), app(), app()]).find((x) => x.label === "Tracked apps")!.value).toBe("3");
    });
  });

  describe("heroApp", () => {
    it("prefers an app awaiting approval (the #1 job)", () => {
      expect(heroApp([ranked("r", 3), awaiting("w")])!.id).toBe("w");
    });
    it("falls back to the first measured-rank app when none await", () => {
      expect(heroApp([app({ id: "n" }), ranked("r", 8)])!.id).toBe("r");
    });
    it("falls back to the first app, else null", () => {
      expect(heroApp([app({ id: "only" })])!.id).toBe("only");
      expect(heroApp([])).toBeNull();
    });
  });

  describe("pendingCount", () => {
    it("counts awaiting-approval runs", () => {
      expect(pendingCount([awaiting("a"), ranked("b", 1), awaiting("c")])).toBe(2);
    });
  });
});

import { recordedProposalsLabel } from "./dashboardModel.js";

describe("recordedProposalsLabel (#493)", () => {
  const since = "2026-08-29T00:00:00.000Z";
  it("names the count and why nothing was pushed", () => {
    expect(recordedProposalsLabel(app({ recorded_proposals: { runs: 1, proposals: 3, since } }))).toBe(
      "3 proposals recorded · nothing moved",
    );
    expect(recordedProposalsLabel(app({ recorded_proposals: { runs: 1, proposals: 1, since } }))).toBe(
      "1 proposal recorded · nothing moved",
    );
  });
  it("is silent for zero, for an absent count, and for a row already at the gate", () => {
    expect(recordedProposalsLabel(app({ recorded_proposals: { runs: 2, proposals: 0, since } }))).toBeNull();
    expect(recordedProposalsLabel(app({}))).toBeNull();
    expect(recordedProposalsLabel(app({ recorded_proposals: null }))).toBeNull();
    expect(
      recordedProposalsLabel(
        app({
          latest_run: { status: "awaiting_approval", created_at: "2026-09-01T00:00:00Z" },
          recorded_proposals: { runs: 1, proposals: 2, since },
        }),
      ),
    ).toBeNull();
  });
});
