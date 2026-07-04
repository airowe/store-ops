import { describe, expect, it } from "vitest";
import { buildKeywordField, composeSubtitle, optimizeCopy, validateCopy } from "./optimize.js";
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

  // #76: preserve the user's original casing (e.g. the acronym "MRI"). We
  // case-fold only for dedupe/comparison, NOT in the emitted field — lowercasing
  // "MRI"→"mri" is a fake "change" (Apple matching is case-insensitive) that made
  // a no-op proposal look like an improvement.
  it("preserves original casing of kept terms (MRI stays MRI)", () => {
    const field = buildKeywordField(["healthcare", "MRI", "insurance"]);
    expect(field).toBe("healthcare,MRI,insurance");
  });

  it("still de-dupes case-insensitively while keeping the first casing", () => {
    const field = buildKeywordField(["MRI", "mri", "healthcare"]);
    expect(field).toBe("MRI,healthcare"); // dup dropped, original casing kept
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

  it("when writable with an EMPTY live subtitle, COMPOSES a multi-word phrase (not a bare keyword)", () => {
    const copy = optimizeCopy(scored, { name: "App", subtitle: "", keywords: "" }, { canWriteSubtitleKeywords: true });
    // composed from multiple top terms, not the lone "calm focus" Secondary term
    expect(copy.subtitle.split(/\s+/).length).toBeGreaterThan(1);
    expect(copy.subtitle.length).toBeLessThanOrEqual(CHAR_LIMITS.subtitle);
    expect(copy.keywords.length).toBeGreaterThan(0);
  });

  it("defaults to writable=true when the flag is omitted (back-compat for existing callers)", () => {
    const copy = optimizeCopy(scored, { name: "App", subtitle: "Calm mind" });
    expect(copy.subtitle).toBe("Calm mind");
    expect(copy.keywords.length).toBeGreaterThan(0);
  });
});

// ── #38/#37/#28: compose-from-scratch (authoring) vs edit (preserve floor) ──
describe("optimizeCopy — compose-from-scratch authoring", () => {
  const scored: ScoredKeyword[] = [
    { keyword: "meditation", volume: 90, difficulty: 30, relevance: 90, score: 84, bucket: "Primary", field: "name" },
    { keyword: "calm", volume: 80, difficulty: 30, relevance: 85, score: 80, bucket: "Secondary", field: "subtitle" },
    { keyword: "stoic", volume: 70, difficulty: 30, relevance: 80, score: 73, bucket: "Secondary", field: "subtitle" },
    { keyword: "mindfulness", volume: 60, difficulty: 30, relevance: 70, score: 64, bucket: "Long-tail", field: "keywords" },
    { keyword: "focus", volume: 55, difficulty: 30, relevance: 65, score: 60, bucket: "Long-tail", field: "keywords" },
  ];

  // Defect 1: an empty subtitle must be COMPOSED from multiple top terms, not a
  // single bare keyword ("meditation").
  it("composes an empty subtitle into a multi-word ≤30-char phrase from several top terms", () => {
    const copy = optimizeCopy(scored, { name: "Heathen", subtitle: "", keywords: "" }, { canWriteSubtitleKeywords: true });
    expect(copy.subtitle.length).toBeGreaterThan(0);
    expect(copy.subtitle.length).toBeLessThanOrEqual(CHAR_LIMITS.subtitle);
    // more than one word — proves it is composed, not a lone keyword
    expect(copy.subtitle.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
    // no trailing punctuation
    expect(copy.subtitle).not.toMatch(/[,\s]$/);
    // valid + within limits
    expect(copy.validation.checks.find((c) => c.field === "subtitle")?.ok).toBe(true);
  });

  // Defect 3: a single bare keyword is WEAK → authored from scratch.
  it("treats a single-word live subtitle as weak and composes a richer phrase", () => {
    const copy = optimizeCopy(scored, { name: "Heathen", subtitle: "meditation", keywords: "" }, { canWriteSubtitleKeywords: true });
    expect(copy.subtitle.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
    expect(copy.subtitle.length).toBeLessThanOrEqual(CHAR_LIMITS.subtitle);
  });

  // Defect 3 / #30: a STRONG existing subtitle is preserved (never regressed).
  it("preserves a strong multi-word existing subtitle (no regression)", () => {
    const strong = "Stoic calm for atheists";
    const copy = optimizeCopy(scored, { name: "Heathen", subtitle: strong, keywords: "" }, { canWriteSubtitleKeywords: true });
    expect(copy.subtitle).toBe(strong);
  });

  // Defect 2: gap terms make it into the keyword field when there is room.
  it("adds new gap terms to the keyword field when the live field has spare room", () => {
    const copy = optimizeCopy(
      scored,
      { name: "Heathen", subtitle: "", keywords: "journal,sleep" },
      { canWriteSubtitleKeywords: true },
    );
    // live floor preserved
    expect(copy.keywords).toContain("journal");
    expect(copy.keywords).toContain("sleep");
    // and gap terms got in
    expect(copy.keywords).toContain("mindfulness");
    expect(copy.keywords.length).toBeLessThanOrEqual(CHAR_LIMITS.keywords);
  });

  // Defect 2: when the live field is packed full, gap terms displace REDUNDANT
  // existing terms rather than being silently dropped — and any genuine drops are
  // surfaced, never a silent no-op.
  it("never silently starves gap terms — surfaces dropped count when the field is full", () => {
    // a long live field packed with low-value terms, leaving no native room
    const packed = [
      "alphaword", "bravoword", "charlieword", "deltaword", "echoword", "foxtrotword",
      "golfword", "hotelword", "indiaword", "julietword",
    ].join(",");
    expect(packed.length).toBeGreaterThan(90);
    const copy = optimizeCopy(
      scored,
      { name: "Heathen", subtitle: "", keywords: packed },
      { canWriteSubtitleKeywords: true },
    );
    // gap terms either made it in OR were explicitly surfaced as dropped — never silent
    const gotGapTerm = copy.keywords.includes("mindfulness") || copy.keywords.includes("focus");
    const surfaced = (copy.optimization?.droppedKeywords?.length ?? 0) > 0;
    expect(gotGapTerm || surfaced).toBe(true);
    expect(copy.keywords.length).toBeLessThanOrEqual(CHAR_LIMITS.keywords);
  });

  // #30 floor safety re-stated for keywords: a strong rich live field is preserved.
  it("preserves a strong rich keyword field (niche terms kept)", () => {
    const rich = "mindfulness,journal,affirmation,anxiety,sleep,philosophy,aurelius,seneca,agnostic";
    const copy = optimizeCopy(
      scored,
      { name: "Heathen", subtitle: "Stoic calm for atheists", keywords: rich },
      { canWriteSubtitleKeywords: true },
    );
    expect(copy.keywords).toContain("aurelius");
    expect(copy.keywords).toContain("agnostic");
    expect(copy.keywords).toContain("seneca");
  });

  // #30 gate: when not writable, NOTHING is composed regardless of terms.
  it("composes nothing when subtitle/keywords are not writable (the #30 gate holds)", () => {
    const copy = optimizeCopy(scored, { name: "Heathen", subtitle: "", keywords: "" }, { canWriteSubtitleKeywords: false });
    expect(copy.subtitle).toBe("");
    expect(copy.keywords).toBe("");
    expect(copy.optimization?.droppedKeywords ?? "").toBe("");
  });
});

describe("composeSubtitle — deterministic natural-phrase authoring", () => {
  it("joins multiple terms into a ≤30-char phrase with more than one word", () => {
    const out = composeSubtitle(["calm", "stoic", "mindfulness"]);
    expect(out.length).toBeLessThanOrEqual(CHAR_LIMITS.subtitle);
    expect(out.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
    expect(out).not.toMatch(/[,\s]$/);
  });

  it("is deterministic (same input → same output)", () => {
    const a = composeSubtitle(["calm", "stoic", "focus"]);
    const b = composeSubtitle(["calm", "stoic", "focus"]);
    expect(a).toBe(b);
  });

  it("drops trailing terms that would exceed the 30-char budget", () => {
    const out = composeSubtitle(["meditation", "mindfulness", "philosophy", "affirmations"]);
    expect(out.length).toBeLessThanOrEqual(CHAR_LIMITS.subtitle);
  });

  it("returns empty string for no usable terms", () => {
    expect(composeSubtitle([])).toBe("");
  });

  // #42: the brand name's words are wasted chars in the subtitle (Apple already
  // ranks the title) — strip them from the composed phrase.
  it("excludes banned name words from the composed phrase (case-insensitive)", () => {
    const out = composeSubtitle(["heathen", "meditation", "mindfulness"], { ban: "Heathen" });
    expect(out.toLowerCase()).not.toContain("heathen");
    expect(out.toLowerCase()).toContain("meditation");
  });

  it("strips multi-word name tokens regardless of case", () => {
    const out = composeSubtitle(["trip", "weatherthere", "forecast"], { ban: "WeatherThere — Trip Forecast" });
    const subWords = new Set(out.toLowerCase().split(/\s+/).filter(Boolean));
    for (const w of ["weatherthere", "trip", "forecast"]) expect(subWords.has(w)).toBe(false);
  });
});

describe("optimizeCopy — subtitle never repeats the app name (#42)", () => {
  // Reproduces the observed leak: secondary/primary terms that collide with the
  // brand name must not surface in the proposed subtitle.
  const nameWord = (name: string) =>
    new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

  it("WeatherThere: proposed subtitle shares no word with the app name", () => {
    const scored: ScoredKeyword[] = [
      { keyword: "weatherthere", volume: 50, difficulty: 30, relevance: 90, score: 80, bucket: "Primary", field: "name" },
      { keyword: "trip", volume: 70, difficulty: 30, relevance: 85, score: 78, bucket: "Secondary", field: "subtitle" },
      { keyword: "forecast", volume: 65, difficulty: 30, relevance: 80, score: 74, bucket: "Secondary", field: "subtitle" },
      { keyword: "rain radar", volume: 60, difficulty: 30, relevance: 75, score: 70, bucket: "Long-tail", field: "keywords" },
    ];
    const copy = optimizeCopy(
      scored,
      { name: "WeatherThere — Trip Forecast", subtitle: "", keywords: "" },
      { canWriteSubtitleKeywords: true },
    );
    const banned = nameWord("WeatherThere — Trip Forecast");
    const subWords = copy.subtitle.toLowerCase().split(/\s+/).filter(Boolean);
    for (const w of subWords) expect(banned.has(w)).toBe(false);
    expect(copy.subtitle.length).toBeGreaterThan(0);
  });

  it("Heathen: proposed subtitle shares no word with the app name", () => {
    const scored: ScoredKeyword[] = [
      { keyword: "heathen", volume: 50, difficulty: 30, relevance: 90, score: 80, bucket: "Primary", field: "name" },
      { keyword: "meditation", volume: 80, difficulty: 30, relevance: 85, score: 80, bucket: "Secondary", field: "subtitle" },
      { keyword: "mindfulness", volume: 70, difficulty: 30, relevance: 80, score: 74, bucket: "Secondary", field: "subtitle" },
      { keyword: "stoic", volume: 60, difficulty: 30, relevance: 75, score: 70, bucket: "Long-tail", field: "keywords" },
    ];
    const copy = optimizeCopy(
      scored,
      { name: "Heathen - Secular Meditation", subtitle: "", keywords: "" },
      { canWriteSubtitleKeywords: true },
    );
    const banned = nameWord("Heathen - Secular Meditation");
    const subWords = copy.subtitle.toLowerCase().split(/\s+/).filter(Boolean);
    for (const w of subWords) expect(banned.has(w)).toBe(false);
    expect(copy.subtitle.length).toBeGreaterThan(0);
  });
});

// ── #59: name-fill suggestion — spare title chars, honest candidates only ─────

describe("optimizeCopy — nameFill suggestion (#59)", () => {
  const sk = (keyword: string, bucket: ScoredKeyword["bucket"], score = 70): ScoredKeyword => ({
    keyword,
    volume: 50,
    difficulty: 30,
    relevance: 80,
    score,
    bucket,
    field: bucket === "Primary" ? "name" : bucket === "Secondary" ? "subtitle" : "keywords",
  });

  it("suggests the strongest scored target that FITS the spare chars — name itself untouched", () => {
    // "Stoic Daily" = 11 chars → 19 spare. "meditation" (10) fits with a space.
    const copy = optimizeCopy(
      [sk("meditation", "Primary"), sk("journal", "Long-tail")],
      { name: "Stoic Daily", subtitle: "Calm mind, clear day", keywords: "" },
    );
    expect(copy.name).toBe("Stoic Daily"); // NEVER silently rewritten
    expect(copy.optimization?.nameFill).toEqual({
      term: "meditation",
      proposedName: "Stoic Daily Meditation",
      spare: CHAR_LIMITS.name - "Stoic Daily".length,
    });
    expect(copy.optimization!.nameFill!.proposedName.length).toBeLessThanOrEqual(CHAR_LIMITS.name);
  });

  it("skips candidates that share a word with the name or proposed subtitle", () => {
    // "daily" collides with the name; "calm focus" collides with the preserved
    // subtitle — "journal" is the first honest candidate left.
    const copy = optimizeCopy(
      [sk("daily planner", "Primary"), sk("calm focus", "Secondary"), sk("journal", "Long-tail")],
      { name: "Stoic Daily", subtitle: "Calm mind, clear day", keywords: "" },
    );
    expect(copy.optimization?.nameFill?.term).toBe("journal");
  });

  it("no candidate fits → NO suggestion (never filler-for-filler's-sake)", () => {
    // 23-char name leaves 7 spare — "meal planner" (12) can't fit, and no
    // shorter candidate exists. Honest silence, exactly the Mangia case.
    const copy = optimizeCopy(
      [sk("meal planner", "Primary")],
      { name: "Mangia - Recipe Manager", subtitle: "", keywords: "" },
    );
    expect(copy.optimization?.nameFill).toBeUndefined();
  });

  it("a name at (or hugging) the limit gets no suggestion", () => {
    const name = "X".repeat(CHAR_LIMITS.name); // zero spare
    const copy = optimizeCopy([sk("zen", "Primary")], { name, subtitle: "", keywords: "" });
    expect(copy.optimization?.nameFill).toBeUndefined();
  });

  it("multi-word fills render Title Case in the preview; term stays lowercase", () => {
    // A STRONG live subtitle is preserved, so the scored term stays available
    // for the name fill (an authored subtitle would rightly consume it first).
    const copy = optimizeCopy(
      [sk("meal planner", "Primary")],
      { name: "Mangia", subtitle: "Cook with what you have", keywords: "" },
    );
    expect(copy.optimization?.nameFill).toEqual({
      term: "meal planner",
      proposedName: "Mangia Meal Planner",
      spare: CHAR_LIMITS.name - "Mangia".length,
    });
  });

  it("empty base name → no suggestion (nothing to fill)", () => {
    const copy = optimizeCopy([sk("zen", "Primary")], { name: "", subtitle: "", keywords: "" });
    expect(copy.optimization?.nameFill).toBeUndefined();
  });
});
