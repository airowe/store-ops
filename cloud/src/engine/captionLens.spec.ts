import { describe, expect, it, vi } from "vitest";
import { analyzeFirstShot, captionFindings, type CaptionAnalysis } from "./captionLens.js";

describe("captionFindings", () => {
  it("flags a feature-led first caption (measured text quoted as evidence)", () => {
    const out = captionFindings({ caption: "Track every workout", style: "feature" });
    expect(out).toHaveLength(1);
    const f = out[0]!;
    expect(f.id).toBe("caption_feature_led");
    expect(f.surface).toBe("screenshots");
    expect(f.severity).toBe("warn");
    expect(f.impact).toBe("conversion");
    // the caption is quoted verbatim, both in the detail and as evidence
    expect(f.evidence).toBe("Track every workout");
    expect(f.detail).toContain("Track every workout");
    // honesty caveat: flagged, not a verdict
    expect(f.detail).toMatch(/heuristic/i);
  });

  it("emits nothing for an outcome-led caption (good copy → no flag)", () => {
    expect(captionFindings({ caption: "Get stronger in 12 weeks", style: "outcome" })).toEqual([]);
  });

  it("emits nothing for an unclear read (unmeasured → silent)", () => {
    expect(captionFindings({ caption: "???", style: "unclear" })).toEqual([]);
  });

  it("emits nothing when there's no analysis at all", () => {
    expect(captionFindings(null)).toEqual([]);
  });
});

describe("analyzeFirstShot", () => {
  const analysis: CaptionAnalysis = { caption: "Do more", style: "feature" };

  it("analyzes ONLY the first url (cost-bounded to one inference)", async () => {
    const analyzer = vi.fn(async () => analysis);
    const out = await analyzeFirstShot(analyzer, ["a.png", "b.png", "c.png"]);
    expect(out).toEqual(analysis);
    expect(analyzer).toHaveBeenCalledTimes(1);
    expect(analyzer).toHaveBeenCalledWith("a.png");
  });

  it("returns null with no screenshots (never calls the analyzer)", async () => {
    const analyzer = vi.fn(async () => analysis);
    expect(await analyzeFirstShot(analyzer, [])).toBeNull();
    expect(await analyzeFirstShot(analyzer, null)).toBeNull();
    expect(await analyzeFirstShot(analyzer, undefined)).toBeNull();
    expect(analyzer).not.toHaveBeenCalled();
  });

  it("safe-degrades to null when the analyzer throws (never strands the run)", async () => {
    const analyzer = vi.fn(async () => {
      throw new Error("vision timeout");
    });
    expect(await analyzeFirstShot(analyzer, ["a.png"])).toBeNull();
  });

  it("passes an analyzer's null straight through", async () => {
    expect(await analyzeFirstShot(async () => null, ["a.png"])).toBeNull();
  });
});
