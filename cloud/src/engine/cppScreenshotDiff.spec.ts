import { describe, expect, it } from "vitest";
import { cppIdenticalFindings, screenshotSignature } from "./cppScreenshotDiff.js";

describe("screenshotSignature", () => {
  it("is empty for no shots (never matches anything)", () => {
    expect(screenshotSignature([])).toBe("");
    expect(screenshotSignature(null)).toBe("");
    expect(screenshotSignature(undefined)).toBe("");
  });

  it("keys by fileName (lowercased), sorted + de-duped", () => {
    const sig = screenshotSignature([{ fileName: "Hero.png" }, { fileName: "list.png" }, { fileName: "hero.png" }]);
    expect(sig).toBe("hero.png|list.png");
  });

  it("falls back to the asset URL when there's no fileName", () => {
    expect(screenshotSignature([{ imageTemplate: "https://asc/a.png" }])).toBe("https://asc/a.png");
  });

  it("is order-independent (same assets → same signature)", () => {
    const a = screenshotSignature([{ fileName: "a.png" }, { fileName: "b.png" }]);
    const b = screenshotSignature([{ fileName: "b.png" }, { fileName: "a.png" }]);
    expect(a).toBe(b);
  });
});

describe("cppIdenticalFindings", () => {
  const DEFAULT = "hero.png|list.png";

  it("returns [] when the default signature is unknown (can't compare)", () => {
    expect(cppIdenticalFindings(null, [{ id: "c1", screenshotSig: DEFAULT }])).toEqual([]);
    expect(cppIdenticalFindings("", [{ id: "c1", screenshotSig: DEFAULT }])).toEqual([]);
  });

  it("flags a CPP whose screenshots are the same assets as the default", () => {
    const out = cppIdenticalFindings(DEFAULT, [{ id: "c1", name: "Holiday", screenshotSig: DEFAULT }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("cpp_identical_to_default_c1");
    expect(out[0]!.surface).toBe("customProductPages");
    expect(out[0]!.severity).toBe("warn");
    expect(out[0]!.title).toContain("Holiday");
    expect(out[0]!.detail).toMatch(/same assets/i);
  });

  it("stays silent for a CPP with a genuinely different set (good)", () => {
    expect(cppIdenticalFindings(DEFAULT, [{ id: "c1", name: "Holiday", screenshotSig: "x.png|y.png" }])).toEqual([]);
  });

  it("skips a CPP whose screenshots we couldn't read (measured-or-absent, never a false positive)", () => {
    expect(cppIdenticalFindings(DEFAULT, [{ id: "c1", name: "Holiday" }])).toEqual([]);
    expect(cppIdenticalFindings(DEFAULT, [{ id: "c1", screenshotSig: undefined }])).toEqual([]);
  });

  it("is deterministic across multiple CPPs (ordered by id)", () => {
    const out = cppIdenticalFindings(DEFAULT, [
      { id: "c2", screenshotSig: DEFAULT },
      { id: "c1", screenshotSig: DEFAULT },
    ]);
    expect(out.map((f) => f.id)).toEqual(["cpp_identical_to_default_c1", "cpp_identical_to_default_c2"]);
  });
});
