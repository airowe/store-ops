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
