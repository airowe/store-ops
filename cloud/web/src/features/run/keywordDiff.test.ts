import { describe, it, expect } from "vitest";
import { diffKeywords } from "./keywordDiff.js";

describe("diffKeywords", () => {
  it("splits on comma, trims, and classifies added/removed/kept", () => {
    const d = diffKeywords("mindfulness,calm,stress", "mindfulness, stress, sleep");
    expect(d.removed).toEqual(["calm"]);
    expect(d.added).toEqual(["sleep"]);
    expect(d.kept).toEqual(["mindfulness", "stress"]);
  });

  it("treats undefined/empty sides as no terms", () => {
    expect(diffKeywords(undefined, "a,b")).toEqual({ added: ["a", "b"], removed: [], kept: [] });
    expect(diffKeywords("a,b", "")).toEqual({ added: [], removed: ["a", "b"], kept: [] });
    expect(diffKeywords("", "")).toEqual({ added: [], removed: [], kept: [] });
  });

  it("dedupes and ignores empty terms from stray commas", () => {
    const d = diffKeywords("a,,a, b ", "a, b, b");
    expect(d.kept).toEqual(["a", "b"]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("preserves the after-order for kept+added and before-order for removed", () => {
    const d = diffKeywords("z,y,x", "y,z,w");
    expect(d.kept).toEqual(["y", "z"]); // after-order
    expect(d.added).toEqual(["w"]);
    expect(d.removed).toEqual(["x"]);
  });
});
