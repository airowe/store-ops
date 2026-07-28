import { describe, expect, it } from "vitest";
import { buildAppInput } from "./runConfig.js";

/**
 * Keyword seeding from the app name.
 *
 * FOUND IN PRODUCTION: Heathen ("Heathen — Secular Meditation") ranks **#1 of
 * 169** for "secular" and #1 for "secular meditation" — its two best terms by a
 * wide margin. Neither was ever tracked. 126 rank readings across the seeded
 * set (`meditation`, `mindfulness`, `calm`, `stoic`, `sleep`, `anxiety`)
 * recorded a rank of `null` EVERY time: not once did the app rank for any of
 * them.
 *
 * The cause was a hardcoded stop-word. "secular" sat in SEED_STOP, so the one
 * word actually winning was thrown away before ranking, while six generic
 * category seeds it has never ranked for were tracked instead.
 *
 * The general lesson, which is what these tests pin: a DISTINCTIVE qualifier in
 * an app's own name is usually its most winnable term, precisely because it is
 * narrow. Discarding name tokens in favour of broad genre seeds optimizes for
 * the keywords the app is least likely to rank for.
 */
const heathen = {
  id: "app1",
  user_id: "u1",
  bundle_id: "app.airowe.clarity",
  name: "Heathen - Secular Meditation",
  country: "US",
  created_at: "2026-06-13",
} as never;

/** Just the keyword strings, for readable assertions. */
async function seedsFor(app: unknown): Promise<string[]> {
  const input = await buildAppInput(app as never);
  return input.keywords.map((k) => k.keyword);
}

describe("keyword seeds from the app name (#380 follow-up)", () => {
  it("keeps a distinctive qualifier from the app's own name", async () => {
    const seeds = await seedsFor(heathen);
    expect(seeds).toContain("secular");
  });

  it("still seeds the genre terms alongside it", async () => {
    // The fix must ADD the name token, not replace the category coverage —
    // broad terms are worth tracking even when the app doesn't rank yet, since
    // that absence is itself a measurement.
    const seeds = await seedsFor(heathen);
    expect(seeds).toContain("meditation");
    expect(seeds).toContain("mindfulness");
  });

  it("ranks a name token above a generic genre seed", async () => {
    // Relevance drives the scorer. A word the developer chose to put in their
    // own name is a stronger signal than a category default.
    const input = await buildAppInput(heathen as never);
    const secular = input.keywords.find((k) => k.keyword === "secular");
    const genre = input.keywords.find((k) => k.keyword === "mindfulness");
    expect(secular).toBeDefined();
    expect(genre).toBeDefined();
    expect(secular!.relevance).toBeGreaterThan(genre!.relevance);
  });

  /**
   * The stop list still has a job. These are words that carry no search intent
   * on their own, and seeding them would waste a tracked slot on a term no user
   * types with purpose.
   */
  it("still drops words that carry no search intent", async () => {
    const seeds = await seedsFor({ ...(heathen as object), name: "The Best Free Pro App" });
    for (const junk of ["the", "best", "free", "pro", "app"]) {
      expect(seeds).not.toContain(junk);
    }
  });

  /**
   * SEED_STOP is consulted on TWO paths: seedKeywordsFromName (the fallback)
   * and candidateTokensFromName (the tokens handed to the LLM reasoner). A word
   * removed from the stop list must reach both, or the reasoner would still
   * never see "secular" as a candidate.
   */
  it("offers the qualifier to the LLM reasoner path too, not just the fallback", async () => {
    const prompts: string[] = [];
    await buildAppInput(heathen as never, {
      descriptionHint: "A secular meditation app for people without religion.",
      // Reasoner is (prompt) => Promise<string>. This one records what it was
      // asked, so the assertion is about the CANDIDATES the code offers, not
      // about model behaviour.
      reasoner: async (prompt: string) => {
        prompts.push(prompt);
        return JSON.stringify({ keywords: [{ keyword: "secular", relevance: 95 }] });
      },
    });
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0]).toMatch(/secular/i);
  });

  it("drops tokens shorter than three characters", async () => {
    const seeds = await seedsFor({ ...(heathen as object), name: "Go To My App" });
    expect(seeds).not.toContain("go");
    expect(seeds).not.toContain("to");
    expect(seeds).not.toContain("my");
  });
});
