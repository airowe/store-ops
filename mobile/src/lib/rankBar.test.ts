import { rankFill } from "./rankBar.js";

describe("rankFill", () => {
  it("rank #1 fills the bar", () => {
    expect(rankFill(1)).toBe(1);
  });
  it("a mid rank is partially filled and monotonic", () => {
    const r10 = rankFill(10);
    const r25 = rankFill(25);
    expect(r10).toBeGreaterThan(r25);
    expect(r10).toBeGreaterThan(0);
    expect(r10).toBeLessThan(1);
  });
  it("a deep-but-measured rank keeps a minimal sliver (never zero)", () => {
    expect(rankFill(200)).toBeGreaterThanOrEqual(0.02);
  });
  it("HONESTY: an unmeasured (null) rank returns 0 — the component renders no bar", () => {
    expect(rankFill(null)).toBe(0);
  });
});
