import { describe, expect, it } from "vitest";
import { localizerForEnv } from "./aiLocalizer.js";

describe("localizerForEnv (#78 Phase 1)", () => {
  it("no binding → null (the route 503s honestly; never a fake translation)", () => {
    expect(localizerForEnv(undefined)).toBeNull();
  });

  it("sends the locale + kind instruction and returns the cleaned line", async () => {
    let captured: { model: string; input: unknown } | null = null;
    const ai = {
      run: async (model: string, input: unknown) => {
        captured = { model, input };
        return { response: '  "Rezept Planer"  ' };
      },
    };
    const localize = localizerForEnv(ai)!;
    const out = await localize({ text: "recipe planner", targetLocale: "de-DE", kind: "keyword" });
    expect(out).toBe("Rezept Planer"); // wrapping quotes stripped
    const msgs = (captured!.input as { messages: Array<{ role: string; content: string }> }).messages;
    expect(msgs[0]!.content).toContain("⟦N⟧ placeholders");
    expect(msgs[1]!.content).toContain('"de-DE"');
    expect(msgs[1]!.content).toContain("SEARCH KEYWORD");
    expect(msgs[1]!.content).toContain("recipe planner");
  });

  it("an empty model reply throws (refusal upstream, never an empty field)", async () => {
    const ai = { run: async () => ({ response: "   " }) };
    const localize = localizerForEnv(ai)!;
    await expect(
      localize({ text: "x", targetLocale: "ja", kind: "name" }),
    ).rejects.toThrow(/empty translation/);
  });
});
