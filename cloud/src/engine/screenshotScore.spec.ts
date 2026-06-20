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
    expect(few.score!).toBeLessThan(score("x", listing(6)).score!);
  });

  it("grades a full set well (A or B, >=70)", () => {
    const res = score("x", listing(8, 4));
    expect(res.score).toBeGreaterThanOrEqual(70);
    expect(["A", "B"]).toContain(res.grade);
  });

  it("awards points for an iPad set", () => {
    expect(score("x", listing(6, 5)).score!).toBeGreaterThan(score("x", listing(6, 0)).score!);
  });

  it("scores a tall ratio higher than a wide one", () => {
    expect(score("x", listing(6, 0, TALL)).score!).toBeGreaterThan(
      score("x", listing(6, 0, WIDE)).score!,
    );
  });

  it("caps the score at 100", () => {
    expect(score("x", listing(10, 10, TALL)).score!).toBeLessThanOrEqual(100);
  });

  it.each([
    [0, "F"],
    [10, "A"],
  ])("count=%i yields grade %s for a tall iPad-backed set", (n, grade) => {
    const res = score("x", listing(n, n, TALL));
    expect(res.grade).toBe(grade);
  });
});

// #41: the public iTunes API cannot reliably report screenshots — an empty set
// from it means UNKNOWN, not zero. We must never assert "grade F / can't convert"
// off data that can't see the screenshots.
describe("screenshot grading — unreadable data is unknown, not zero (#41)", () => {
  it("grades an empty set from unreliable data as UNKNOWN, not F", () => {
    const res = score("x", { screenshotUrls: [], ipadScreenshotUrls: [], dataReliable: false });
    expect(res.grade).toBe("?");
    expect(res.score).toBeNull();
    // Honest finding — no "can't convert", no "No iPhone screenshots".
    expect(res.findings.some((f) => /No iPhone screenshots/.test(f))).toBe(false);
    expect(res.findings.some((f) => /can't convert/.test(f))).toBe(false);
    expect(res.findings.some((f) => /couldn't read|App Store Connect/i.test(f))).toBe(true);
  });

  it("still grades a real screenshot set even when data is unreliable", () => {
    // If the unreliable source DID return shots, score them normally (they're real).
    const res = score("x", { screenshotUrls: Array.from({ length: 6 }, () => TALL), ipadScreenshotUrls: [], dataReliable: false });
    expect(res.grade).not.toBe("?");
    expect(res.score).toBeGreaterThanOrEqual(50);
  });

  it("keeps the hard F for a genuinely-empty set when data IS reliable", () => {
    const res = score("x", { screenshotUrls: [], ipadScreenshotUrls: [], dataReliable: true });
    expect(res.grade).toBe("F");
  });
});

// #47: the score carries the REAL screenshot URLs (App Store order) so the
// run/audit page can render the actual shots next to the grade. Honesty rule
// (#41): when the set is unreadable ("?"), it carries NO urls — never a fake set.
describe("screenshot scoring — carries the real screenshot urls (#47)", () => {
  const A = "https://is1.mzstatic.com/image/thumb/x/v4/a/b/c/1290x2796bb.png";
  const B = "https://is1.mzstatic.com/image/thumb/x/v4/d/e/f/1290x2796bb.png";
  const IPAD = "https://is1.mzstatic.com/image/thumb/x/v4/g/h/i/2048x2732bb.png";

  it("returns the iPhone + iPad urls verbatim, in order, when the set is readable", () => {
    const res = score("x", { screenshotUrls: [A, B], ipadScreenshotUrls: [IPAD], dataReliable: true });
    expect(res.screenshotUrls).toEqual([A, B]);
    expect(res.ipadScreenshotUrls).toEqual([IPAD]);
  });

  it("carries real urls even from an unreliable source that DID return shots", () => {
    const res = score("x", { screenshotUrls: [A, B], ipadScreenshotUrls: [], dataReliable: false });
    expect(res.grade).not.toBe("?");
    expect(res.screenshotUrls).toEqual([A, B]);
  });

  it("carries NO urls when the set is unreadable (the '?' branch — no fake gallery)", () => {
    const res = score("x", { screenshotUrls: [], ipadScreenshotUrls: [], dataReliable: false });
    expect(res.grade).toBe("?");
    expect(res.screenshotUrls).toEqual([]);
    expect(res.ipadScreenshotUrls).toEqual([]);
  });

  it("never returns null/undefined url arrays (stable shape for the client)", () => {
    const res = score("x", {});
    expect(Array.isArray(res.screenshotUrls)).toBe(true);
    expect(Array.isArray(res.ipadScreenshotUrls)).toBe(true);
  });
});
