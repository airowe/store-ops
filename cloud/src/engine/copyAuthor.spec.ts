/**
 * Authored subtitles — the guardrails ARE the feature. The model (injected
 * fake here) may return anything; only copy that obeys every stated rule ever
 * reaches a proposal, and every failure degrades to null so the deterministic
 * composer keeps the run honest.
 */
import { describe, expect, it } from "vitest";
import { authorSubtitle, buildSubtitlePrompt, validateAuthoredSubtitle } from "./copyAuthor.js";

const INPUTS = {
  appName: "Mangia",
  description:
    "Import recipes from anywhere, plan your meals for the week, and keep a smart pantry so you always know what to cook.",
  targets: ["recipe importer", "meal planner", "pantry"],
};

const ok = (subtitle: string) => async () => JSON.stringify({ subtitle });

describe("authorSubtitle", () => {
  it("returns validated copy from a well-behaved model", async () => {
    const out = await authorSubtitle(ok("Import recipes, plan meals"), INPUTS);
    expect(out).toBe("Import recipes, plan meals");
  });

  it("tolerates markdown fences and surrounding prose", async () => {
    const reasoner = async () =>
      'Here you go:\n```json\n{"subtitle": "Plan meals and track pantry"}\n```';
    expect(await authorSubtitle(reasoner, INPUTS)).toBe("Plan meals and track pantry");
  });

  it("rejects over-limit copy instead of truncating it", async () => {
    const long = "Plan every meal and import recipes forever"; // > 30 chars
    expect(long.length).toBeGreaterThan(30);
    expect(await authorSubtitle(ok(long), INPUTS)).toBeNull();
  });

  it("rejects copy that repeats a brand word (#42)", async () => {
    expect(await authorSubtitle(ok("Mangia your meal planner"), INPUTS)).toBeNull();
  });

  it("rejects price claims — the 2.3.7 class", async () => {
    expect(await authorSubtitle(ok("Plan meals for free"), INPUTS)).toBeNull();
    expect(await authorSubtitle(ok("Recipes at 50% off"), INPUTS)).toBeNull();
  });

  it("rejects copy that carries no target keyword — this surface exists to rank", async () => {
    expect(await authorSubtitle(ok("Cook something great tonight"), INPUTS)).toBeNull();
  });

  it("rejects a single bare word — same bar as isStrongSubtitle", async () => {
    expect(await authorSubtitle(ok("Recipes"), INPUTS)).toBeNull();
  });

  it("garbage output → null, model errors → null (never throws)", async () => {
    expect(await authorSubtitle(async () => "not json at all", INPUTS)).toBeNull();
    expect(
      await authorSubtitle(async () => {
        throw new Error("api down");
      }, INPUTS),
    ).toBeNull();
  });

  it("no targets → null without spending a model call", async () => {
    let called = false;
    const reasoner = async () => {
      called = true;
      return "{}";
    };
    expect(await authorSubtitle(reasoner, { ...INPUTS, targets: [] })).toBeNull();
    expect(called).toBe(false);
  });
});

describe("prompt + validator details", () => {
  it("the prompt states the hard limit, the brand ban, and the JSON contract", () => {
    const prompt = buildSubtitlePrompt(INPUTS);
    expect(prompt).toContain("At most 30 characters");
    expect(prompt).toContain('"Mangia"');
    expect(prompt).toContain("recipe importer, meal planner, pantry");
    expect(prompt).toContain('{"subtitle": "..."}');
  });

  it("validator normalizes whitespace before judging", () => {
    expect(validateAuthoredSubtitle("  Plan   meals with ease ", INPUTS)).toBe(
      "Plan meals with ease",
    );
  });
});
