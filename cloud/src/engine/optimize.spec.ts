import { describe, expect, it } from "vitest";
import { buildKeywordField, optimizeCopy, validateCopy } from "./optimize.js";
import { CHAR_LIMITS } from "./constants.js";
import type { ScoredKeyword } from "./keywords.js";

describe("validateCopy — char-limit + keyword-field guards", () => {
  it("passes compliant copy", () => {
    const v = validateCopy({
      name: "Stoic Daily",
      subtitle: "Calm mind, clear day",
      keywords: "meditation,journal,philosophy",
    });
    expect(v.pass).toBe(true);
    expect(v.checks.every((c) => c.ok)).toBe(true);
  });

  it.each([
    ["name", "X".repeat(CHAR_LIMITS.name + 1)],
    ["subtitle", "Y".repeat(CHAR_LIMITS.subtitle + 1)],
    ["keywords", "z".repeat(CHAR_LIMITS.keywords + 1)],
  ])("fails when %s exceeds its limit", (field, value) => {
    const base = { name: "ok", subtitle: "ok", keywords: "ok" };
    const v = validateCopy({ ...base, [field]: value });
    expect(v.pass).toBe(false);
    const check = v.checks.find((c) => c.field === field);
    expect(check?.ok).toBe(false);
    expect(check?.issues.join(" ")).toContain("over limit");
  });

  it("rejects a keyword field with spaces after commas", () => {
    const v = validateCopy({ name: "A", subtitle: "B", keywords: "one, two, three" });
    expect(v.pass).toBe(false);
    const kw = v.checks.find((c) => c.field === "keywords");
    expect(kw?.issues.join(" ")).toContain("NO spaces");
  });

  it("rejects keyword-field terms that duplicate a title/subtitle word", () => {
    const v = validateCopy({
      name: "Stoic Journal",
      subtitle: "Calm",
      keywords: "stoic,meditation",
    });
    expect(v.pass).toBe(false);
    const kw = v.checks.find((c) => c.field === "keywords");
    expect(kw?.issues.join(" ")).toContain("duplicates");
  });

  it("reports per-field char counts", () => {
    const v = validateCopy({ name: "Stoic", subtitle: "Calm", keywords: "a,b" });
    expect(v.checks.find((c) => c.field === "name")?.count).toBe(5);
    expect(v.checks.find((c) => c.field === "keywords")?.count).toBe(3);
  });
});

describe("buildKeywordField — compliant construction", () => {
  it("joins comma-separated with NO spaces and stays within 100 chars", () => {
    const field = buildKeywordField(["meditation", "journal", "calm", "focus"]);
    expect(field).toBe("meditation,journal,calm,focus");
    expect(field.length).toBeLessThanOrEqual(CHAR_LIMITS.keywords);
    expect(field).not.toContain(", ");
  });

  it("drops terms that collide with the title/subtitle", () => {
    const field = buildKeywordField(["stoic", "meditation"], { name: "Stoic Daily" });
    expect(field).toBe("meditation");
  });

  it("never exceeds the 100-char limit (greedy packing)", () => {
    const many = Array.from({ length: 40 }, (_, i) => `keyword${i}`);
    const field = buildKeywordField(many);
    expect(field.length).toBeLessThanOrEqual(CHAR_LIMITS.keywords);
  });
});

describe("optimizeCopy — never emits over-limit copy", () => {
  const scored: ScoredKeyword[] = [
    { keyword: "meditation", volume: 90, difficulty: 30, relevance: 90, score: 84, bucket: "Primary", field: "name" },
    { keyword: "calm focus", volume: 70, difficulty: 40, relevance: 80, score: 70, bucket: "Secondary", field: "subtitle" },
    { keyword: "daily journal", volume: 50, difficulty: 20, relevance: 70, score: 64, bucket: "Long-tail", field: "keywords" },
    { keyword: "philosophy app", volume: 40, difficulty: 30, relevance: 60, score: 55, bucket: "Long-tail", field: "keywords" },
  ];

  it("produces a fully valid proposed listing", () => {
    const copy = optimizeCopy(scored, {
      name: "Stoic Daily",
      subtitle: "Calm mind, clear day",
    });
    expect(copy.validation.pass).toBe(true);
    expect(copy.name.length).toBeLessThanOrEqual(CHAR_LIMITS.name);
    expect(copy.keywords.length).toBeLessThanOrEqual(CHAR_LIMITS.keywords);
    expect(copy.keywords).not.toContain(", ");
  });

  it("truncates an over-long base name to fit", () => {
    const copy = optimizeCopy(scored, {
      name: "An Extremely Long App Name That Will Not Fit At All In Thirty",
      subtitle: "ok",
    });
    expect(copy.name.length).toBeLessThanOrEqual(CHAR_LIMITS.name);
    expect(copy.validation.checks.find((c) => c.field === "name")?.ok).toBe(true);
  });
});

// ── #30: never blindly overwrite subtitle/keywords we couldn't read ──
describe("optimizeCopy — subtitle/keyword safety (the #30 fix)", () => {
  const scored: ScoredKeyword[] = [
    { keyword: "meditation", volume: 90, difficulty: 30, relevance: 90, score: 84, bucket: "Primary", field: "name" },
    { keyword: "calm focus", volume: 70, difficulty: 40, relevance: 80, score: 70, bucket: "Secondary", field: "subtitle" },
    { keyword: "daily journal", volume: 50, difficulty: 20, relevance: 70, score: 64, bucket: "Long-tail", field: "keywords" },
  ];

  it("when subtitle/keywords are NOT writable (no ASC read), omits them entirely — no blind overwrite", () => {
    const copy = optimizeCopy(scored, { name: "Stoic Daily" }, { canWriteSubtitleKeywords: false });
    // name is still proposed; subtitle + keywords are absent (not a generic guess).
    expect(copy.name).toBeTruthy();
    expect(copy.subtitle).toBe("");
    expect(copy.keywords).toBe("");
    expect(copy.validation.pass).toBe(true);
  });

  it("when writable, IMPROVES an existing good subtitle/keyword set instead of regressing it", () => {
    // The Heathen regression case: a strong live listing must NOT be downgraded.
    const liveGood = {
      name: "Heathen - Secular Meditation",
      subtitle: "Stoic calm for atheists",
      keywords: "mindfulness,journal,affirmation,anxiety,sleep,focus,philosophy,aurelius,seneca,agnostic,gratitude",
    };
    const copy = optimizeCopy(scored, liveGood, { canWriteSubtitleKeywords: true });
    // the existing strong subtitle is preserved (not replaced by "calm focus")
    expect(copy.subtitle).toBe("Stoic calm for atheists");
    // the existing rich keyword field is preserved as a floor (niche terms kept)
    expect(copy.keywords).toContain("aurelius");
    expect(copy.keywords).toContain("agnostic");
    // and it never regresses to fewer chars than the live field
    expect(copy.keywords.length).toBeGreaterThanOrEqual(liveGood.keywords.length - 0);
  });

  it("when writable with an EMPTY live subtitle, fills it from the best secondary term", () => {
    const copy = optimizeCopy(scored, { name: "App", subtitle: "", keywords: "" }, { canWriteSubtitleKeywords: true });
    expect(copy.subtitle).toBe("calm focus"); // filled from the Secondary bucket
    expect(copy.keywords.length).toBeGreaterThan(0);
  });

  it("defaults to writable=true when the flag is omitted (back-compat for existing callers)", () => {
    const copy = optimizeCopy(scored, { name: "App", subtitle: "Calm mind" });
    expect(copy.subtitle).toBe("Calm mind");
    expect(copy.keywords.length).toBeGreaterThan(0);
  });
});
