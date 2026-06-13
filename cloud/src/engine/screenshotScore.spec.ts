import { describe, expect, it } from "vitest";
import { aspectFromUrl, aspectLabel, score, type Listing } from "./screenshotScore.js";

const TALL = "https://is1.mzstatic.com/image/thumb/x/v4/a/b/c/1290x2796bb.png";
const WIDE = "https://is1.mzstatic.com/image/thumb/x/v4/a/b/c/392x696bb.png";

function listing(nIphone = 0, nIpad = 0, url = TALL): Listing {
  return {
    screenshotUrls: Array.from({ length: nIphone }, () => url),
    ipadScreenshotUrls: Array.from({ length: nIpad }, () => "ipad"),
  };
}

describe("aspect parsing", () => {
  it("reads the size token from the URL", () => {
    expect(aspectFromUrl(TALL)).toEqual([1290, 2796]);
    expect(aspectFromUrl(WIDE)).toEqual([392, 696]);
  });

  it("returns null when there is no size token", () => {
    expect(aspectFromUrl("https://x/no-size-here.png")).toBeNull();
  });

  it("labels a tall phone ratio", () => {
    expect(aspectLabel(1290, 2796)).toContain("tall phone");
  });
});

describe("screenshot grading", () => {
  it("grades an empty set F", () => {
    const res = score("x", listing(0));
    expect(res.grade).toBe("F");
    expect(res.iphoneCount).toBe(0);
    expect(res.findings.some((f) => f.includes("No iPhone screenshots"))).toBe(true);
  });

  it("flags a thin set and scores it below a fuller set", () => {
    const few = score("x", listing(2));
    expect(few.findings.some((f) => f.includes("Only 2"))).toBe(true);
    expect(few.score).toBeLessThan(score("x", listing(6)).score);
  });

  it("grades a full set well (A or B, >=70)", () => {
    const res = score("x", listing(8, 4));
    expect(res.score).toBeGreaterThanOrEqual(70);
    expect(["A", "B"]).toContain(res.grade);
  });

  it("awards points for an iPad set", () => {
    expect(score("x", listing(6, 5)).score).toBeGreaterThan(score("x", listing(6, 0)).score);
  });

  it("scores a tall ratio higher than a wide one", () => {
    expect(score("x", listing(6, 0, TALL)).score).toBeGreaterThan(
      score("x", listing(6, 0, WIDE)).score,
    );
  });

  it("caps the score at 100", () => {
    expect(score("x", listing(10, 10, TALL)).score).toBeLessThanOrEqual(100);
  });

  it.each([
    [0, "F"],
    [10, "A"],
  ])("count=%i yields grade %s for a tall iPad-backed set", (n, grade) => {
    const res = score("x", listing(n, n, TALL));
    expect(res.grade).toBe(grade);
  });
});
