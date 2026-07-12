import { describe, expect, it } from "vitest";
import { clusterKeywordIntents } from "./cppIntents.js";

describe("clusterKeywordIntents", () => {
  it("no keywords → no intents (never a fabricated count)", () => {
    expect(clusterKeywordIntents([])).toEqual([]);
    expect(clusterKeywordIntents(["", "   "])).toEqual([]);
  });

  it("groups keywords that share a significant term, naming the cluster by it", () => {
    const intents = clusterKeywordIntents(["radar map", "radar alerts", "trip planner", "trip forecast"]);
    const labels = intents.map((i) => i.label);
    expect(labels).toContain("radar");
    expect(labels).toContain("trip");
    expect(intents.find((i) => i.label === "radar")!.keywords).toEqual(["radar alerts", "radar map"]);
  });

  it("assigns each keyword to exactly one intent (no double-counting)", () => {
    const intents = clusterKeywordIntents(["weather radar", "radar map", "weather forecast"]);
    const all = intents.flatMap((i) => i.keywords);
    expect(all).toHaveLength(3);
    expect(new Set(all).size).toBe(3);
  });

  it("a keyword sharing no term with others becomes its own intent", () => {
    const intents = clusterKeywordIntents(["meal planner", "meal prep", "budgeting"]);
    expect(intents.find((i) => i.label === "meal")!.keywords).toEqual(["meal planner", "meal prep"]);
    expect(intents.map((i) => i.label)).toContain("budgeting");
  });

  it("is deterministic and de-dupes case-insensitively", () => {
    const a = clusterKeywordIntents(["Radar Map", "radar map", "trip planner"]);
    const b = clusterKeywordIntents(["trip planner", "radar map", "RADAR MAP"]);
    expect(a).toEqual(b);
    // "radar map" de-duped → 2 distinct keywords, 2 intents
    expect(a.flatMap((i) => i.keywords)).toHaveLength(2);
  });

  it("ignores stopwords and short tokens when choosing labels", () => {
    const intents = clusterKeywordIntents(["best free app", "free app deals"]);
    // "free" is a stopword, "app" too, so they don't become intent labels
    expect(intents.every((i) => !["free", "app", "best"].includes(i.label))).toBe(true);
  });

  it("sorts by cluster size desc, then label asc", () => {
    const intents = clusterKeywordIntents(["radar map", "radar alerts", "radar live", "trip planner"]);
    expect(intents[0]!.label).toBe("radar"); // biggest cluster first
    expect(intents[0]!.keywords).toHaveLength(3);
  });
});
