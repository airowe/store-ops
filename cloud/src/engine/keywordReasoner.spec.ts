import { describe, it, expect } from "vitest";
import {
  type Reasoner,
  reconcileReasoning,
  reasonKeywords,
  classifyDeterministic,
} from "./keywordReasoner";

// The recurring fixture: "Mangia - Recipe Manager", a recipe-import + pantry +
// meal-planning app. This is the exact case from issue #57.
const MANGIA = {
  appName: "Mangia - Recipe Manager",
  description:
    "Import recipes from any website, organize your pantry, build a grocery " +
    "list, and plan your meals for the week. Mangia is your kitchen companion.",
  candidateTokens: ["mangia", "recipe", "manager"],
};

/** A fake reasoner that always returns the same canned model text. */
const fakeReasoner =
  (canned: string): Reasoner =>
  async () =>
    canned;

describe("reconcileReasoning — honesty guardrails", () => {
  it("drops a hallucinated target that is NOT in the description or name", () => {
    // The model invents "cryptocurrency" — a word nowhere in the grounding text.
    const raw = JSON.stringify({
      brand: [],
      target: ["recipe", "cryptocurrency"],
      drop: [],
    });
    const out = reconcileReasoning(raw, MANGIA);
    expect(out.target).toContain("recipe");
    expect(out.target).not.toContain("cryptocurrency");
    expect(out.dropped).toContain("cryptocurrency");
  });

  it("drops a generic title token ('manager') the model tried to target", () => {
    // "manager" is in the TITLE but not the description — it is not a real
    // search intent for a recipe app, so it must be dropped.
    const raw = JSON.stringify({
      brand: [],
      target: ["recipe", "manager"],
      drop: [],
    });
    const out = reconcileReasoning(raw, MANGIA);
    expect(out.target).toContain("recipe");
    expect(out.target).not.toContain("manager");
    expect(out.dropped).toContain("manager");
  });

  it("forces an appName word ('mangia') to brand even if the model says target", () => {
    const raw = JSON.stringify({
      brand: [],
      target: ["mangia", "recipe"],
      drop: [],
    });
    const out = reconcileReasoning(raw, MANGIA);
    expect(out.brand).toContain("mangia");
    expect(out.target).not.toContain("mangia");
    expect(out.target).toContain("recipe");
  });

  it("keeps description-substantiated terms as target (recipe, pantry, meal)", () => {
    const raw = JSON.stringify({
      brand: ["mangia"],
      target: ["recipe", "pantry", "meal"],
      drop: ["manager"],
    });
    const out = reconcileReasoning(raw, MANGIA);
    expect(out.target).toEqual(expect.arrayContaining(["recipe", "pantry", "meal"]));
    expect(out.brand).toContain("mangia");
    expect(out.dropped).toContain("manager");
  });

  it("substantiates multi-word targets by checking every word", () => {
    const raw = JSON.stringify({
      brand: [],
      // "meal planning": both words substantiated ("plan"/"meals" in desc) → kept.
      // "crypto wallet": neither word substantiated → dropped.
      target: ["meal planning", "crypto wallet"],
      drop: [],
    });
    const out = reconcileReasoning(raw, MANGIA);
    expect(out.target).toContain("meal planning");
    expect(out.target).not.toContain("crypto wallet");
    expect(out.dropped).toContain("crypto wallet");
  });

  it("deduplicates and lowercases", () => {
    const raw = JSON.stringify({
      brand: [],
      target: ["Recipe", "recipe", "RECIPE"],
      drop: [],
    });
    const out = reconcileReasoning(raw, MANGIA);
    expect(out.target.filter((t) => t === "recipe")).toHaveLength(1);
  });
});

describe("reasonKeywords — orchestration + robust fallback", () => {
  it("falls back to classifyDeterministic on malformed model output (no throw)", async () => {
    const out = await reasonKeywords(MANGIA, fakeReasoner("not json at all {{{"));
    // Deterministic fallback: mangia is brand, recipe is target, manager dropped.
    expect(out.brand).toContain("mangia");
    expect(out.target).toContain("recipe");
    expect(out.target).not.toContain("manager");
    expect(out.target).not.toContain("mangia");
  });

  it("falls back when the JSON is valid but the schema is wrong", async () => {
    const out = await reasonKeywords(MANGIA, fakeReasoner('{"foo":1,"bar":[]}'));
    expect(out.brand).toContain("mangia");
    expect(out.target).toContain("recipe");
  });

  it("falls back when the reasoner throws", async () => {
    const throwing: Reasoner = async () => {
      throw new Error("model unavailable");
    };
    const out = await reasonKeywords(MANGIA, throwing);
    expect(out.brand).toContain("mangia");
    expect(out.target).toContain("recipe");
  });

  it("extracts JSON embedded in prose / markdown fences", async () => {
    const canned =
      "Sure! Here is the classification:\n```json\n" +
      JSON.stringify({ brand: ["mangia"], target: ["recipe", "pantry"], drop: ["manager"] }) +
      "\n```\nHope that helps.";
    const out = await reasonKeywords(MANGIA, fakeReasoner(canned));
    expect(out.brand).toContain("mangia");
    expect(out.target).toEqual(expect.arrayContaining(["recipe", "pantry"]));
    expect(out.dropped).toContain("manager");
    // Even via the model, the honesty guardrail still applies.
    expect(out.target).not.toContain("manager");
  });

  it("uses the deterministic classifier when no reasoner is provided", async () => {
    const out = await reasonKeywords(MANGIA);
    expect(out.brand).toContain("mangia");
    expect(out.target).toContain("recipe");
    expect(out.target).not.toContain("manager");
  });

  it("a model that hallucinates is still constrained to the description", async () => {
    const canned = JSON.stringify({
      brand: [],
      target: ["recipe", "investing", "manager"],
      drop: [],
    });
    const out = await reasonKeywords(MANGIA, fakeReasoner(canned));
    expect(out.target).toContain("recipe");
    expect(out.target).not.toContain("investing");
    expect(out.target).not.toContain("manager");
    expect(out.brand).toContain("mangia");
  });
});

describe("classifyDeterministic — no LLM", () => {
  it("classifies appName words as brand, keeps substantiated tokens, drops junk", () => {
    const out = classifyDeterministic(MANGIA);
    expect(out.brand).toContain("mangia");
    expect(out.target).toContain("recipe");
    expect(out.dropped).toContain("manager");
    expect(out.target).not.toContain("mangia");
    expect(out.target).not.toContain("manager");
  });

  it("folds in food genre seeds when the description mentions recipe/pantry", () => {
    const out = classifyDeterministic(MANGIA);
    // The food intent set, scanned from the DESCRIPTION (not the name).
    expect(out.target).toEqual(
      expect.arrayContaining(["recipe", "meal", "cooking", "grocery", "pantry"]),
    );
  });

  it("does not fold genre seeds when the description has no genre signal", () => {
    const out = classifyDeterministic({
      appName: "Bloop",
      description: "A simple utility that does one small thing.",
      candidateTokens: ["bloop"],
    });
    expect(out.brand).toContain("bloop");
    expect(out.target).not.toContain("recipe");
    expect(out.target).not.toContain("pantry");
  });

  it("never lets a brand or junk token leak into the genre-seeded target set", () => {
    const out = classifyDeterministic({
      appName: "Pantry Pro",
      description: "Track your pantry, plan meals, and build a grocery list.",
      candidateTokens: ["pantry", "pro", "manager"],
    });
    // "pantry" and "pro" are appName words → brand, never target, even though
    // "pantry" is also a food-genre seed.
    expect(out.brand).toEqual(expect.arrayContaining(["pantry", "pro"]));
    expect(out.target).not.toContain("pantry");
    expect(out.target).not.toContain("pro");
    // genre seeds still bring the non-brand food terms.
    expect(out.target).toEqual(expect.arrayContaining(["recipe", "meal", "grocery"]));
  });

  it("returns disjoint brand/target/dropped sets", () => {
    const out = classifyDeterministic(MANGIA);
    const inTarget = new Set(out.target);
    const inBrand = new Set(out.brand);
    for (const b of out.brand) expect(inTarget.has(b)).toBe(false);
    for (const d of out.dropped) {
      expect(inTarget.has(d)).toBe(false);
      expect(inBrand.has(d)).toBe(false);
    }
  });
});
