import { recordedProposalsLabel } from "./recordedProposals.js";
import type { AppListItem } from "../types/api.js";

function app(over: Partial<AppListItem> = {}): AppListItem {
  return {
    id: "a1",
    bundle_id: "com.acme.app",
    name: "Acme",
    country: "US",
    created_at: "2026-06-01T00:00:00Z",
    latest_run: { id: "r1", status: "detected", created_at: "2026-09-01T00:00:00Z" },
    rank_summary: null,
    findings_summary: null,
    ...over,
  };
}

const since = "2026-08-29T00:00:00.000Z";

describe("recordedProposalsLabel (#493)", () => {
  it("names the count and pluralises", () => {
    expect(recordedProposalsLabel(app({ recorded_proposals: { runs: 1, proposals: 3, since } }))).toBe(
      "3 proposals recorded · nothing moved",
    );
    expect(recordedProposalsLabel(app({ recorded_proposals: { runs: 1, proposals: 1, since } }))).toBe(
      "1 proposal recorded · nothing moved",
    );
  });

  it("says nothing for zero, null, or an absent field — never a 0", () => {
    expect(recordedProposalsLabel(app({ recorded_proposals: { runs: 2, proposals: 0, since } }))).toBeNull();
    expect(recordedProposalsLabel(app({ recorded_proposals: null }))).toBeNull();
    expect(recordedProposalsLabel(app())).toBeNull();
  });

  it("stays quiet on a row that already awaits approval", () => {
    expect(
      recordedProposalsLabel(
        app({
          recorded_proposals: { runs: 1, proposals: 3, since },
          latest_run: { id: "r2", status: "awaiting_approval", created_at: "2026-09-02T00:00:00Z" },
        }),
      ),
    ).toBeNull();
  });
});
