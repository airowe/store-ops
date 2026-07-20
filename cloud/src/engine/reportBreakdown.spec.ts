import { describe, expect, it } from "vitest";
import { buildReportBreakdown, type ReportFieldScore } from "./reportBreakdown.js";
import type { Audit } from "./agent.js";

function audit(over: Partial<Audit> = {}): Audit {
  const base = {
    app: "Calm",
    bundleId: "com.calm.calmapp",
    liveName: "Calm — Sleep & Meditation",
    liveSubtitle: "Sleep more, stress less",
    liveDescription: "Calm is the #1 app for sleep and meditation. ".repeat(10),
    screenshots: { app: "Calm", iphoneCount: 6, ipadCount: 2, score: 88, grade: "A", findings: [], aspectHint: "", screenshotUrls: [], ipadScreenshotUrls: [], levers: [] } as never,
    storefront: {
      ratings: { average: 4.8, count: 1_500_000, histogram: [1, 2, 5, 20, 100] },
      whatsNew: "- New sleep stories",
    },
  } as Audit;
  return { ...base, ...over } as Audit;
}

/** Drop keys so an "unreadable" field is genuinely absent (exactOptionalProps-safe). */
function auditWithout(keys: Array<keyof Audit>): Audit {
  const a = audit() as Record<string, unknown>;
  for (const k of keys) delete a[k as string];
  return a as unknown as Audit;
}

/** Look up a field's score, asserting it's present (the engine emits all six). */
function field(b: ReportFieldScore[], name: ReportFieldScore["field"]): ReportFieldScore {
  const found = b.find((f) => f.field === name);
  if (!found) throw new Error(`report breakdown missing field: ${name}`);
  return found;
}

describe("buildReportBreakdown — honest per-field scored view for the public report", () => {
  it("scores each field it can measure, with a measured value and a reason", () => {
    const b = buildReportBreakdown(audit());
    // title measured from the live name length (≤30 budget)
    expect(field(b, "title").state).toBe("measured");
    expect(field(b, "title").score).toBeGreaterThan(0);
    expect(typeof field(b, "title").note).toBe("string");
    expect(field(b, "subtitle").state).toBe("measured");
    expect(field(b, "description").state).toBe("measured");
    expect(field(b, "screenshots").state).toBe("measured");
    expect(field(b, "ratings").state).toBe("measured");
    expect(field(b, "freshness").state).toBe("measured");
  });

  it("marks a field UNREADABLE (never a fake 0) when the public read didn't carry it", () => {
    const a = auditWithout(["liveSubtitle", "storefront"]);
    a.screenshots = null;
    const b = buildReportBreakdown(a);
    // subtitle absent from the public read → unreadable, not a 0 score
    expect(field(b, "subtitle").state).toBe("unreadable");
    expect(field(b, "subtitle").score).toBeNull();
    // ratings absent → unreadable
    expect(field(b, "ratings").state).toBe("unreadable");
    expect(field(b, "ratings").score).toBeNull();
    // screenshots unreadable (grade "?") → unreadable, never a 0
    expect(field(b, "screenshots").state).toBe("unreadable");
  });

  it("flags a low rating count honestly rather than inflating the score", () => {
    const b = buildReportBreakdown(audit({ storefront: { ratings: { average: 5, count: 3, histogram: [0, 0, 0, 0, 3] } } }));
    const ratings = b.find((f) => f.field === "ratings")!;
    expect(ratings.state).toBe("measured");
    expect(ratings.note).toMatch(/few|low|3/i);
  });

  it("never emits a score above its max or below 0", () => {
    for (const f of buildReportBreakdown(audit()) as ReportFieldScore[]) {
      if (f.score !== null) {
        expect(f.score).toBeGreaterThanOrEqual(0);
        expect(f.score).toBeLessThanOrEqual(f.max);
      }
    }
  });
});
