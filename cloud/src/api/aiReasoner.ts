/**
 * The concrete, env.AI-backed Reasoner (#57). This is the ONE place that touches
 * the Cloudflare Workers AI binding — kept out of the engine so the reasoning
 * logic (keywordReasoner.ts) stays pure and fully unit-testable without a binding.
 *
 * `reasonerForEnv` returns a `Reasoner` (prompt → raw model text) ONLY when the
 * AI binding exists; otherwise undefined, so the run path passes no reasoner and
 * the deterministic classifier takes over. A missing/failing binding NEVER breaks
 * a run — keywordReasoner.reasonKeywords already catches reasoner errors and
 * falls back, and we additionally guard the binding's absence here.
 */
import type { Reasoner } from "../engine/keywordReasoner.js";

/** The text-generation model used for keyword reasoning. Small + cheap + fast. */
const REASONER_MODEL = "@cf/meta/llama-3.1-8b-instruct";

/** Minimal structural type for the AI binding (avoids coupling to the model list). */
type AiLike = { run(model: string, input: unknown): Promise<unknown> };

/**
 * Pull the assistant's text out of a Workers AI text-generation response. The
 * shape is `{ response: string }` for the instruct models, but we read it
 * defensively so an SDK shape change can't throw inside the run path.
 */
function extractText(out: unknown): string {
  if (typeof out === "string") return out;
  if (out && typeof out === "object" && "response" in out) {
    const r = (out as { response?: unknown }).response;
    if (typeof r === "string") return r;
  }
  return "";
}

/**
 * Build a Reasoner over the env.AI binding, or undefined when no binding is
 * present. The returned Reasoner sends the prompt to the instruct model and
 * returns the raw text; reconcileReasoning guardrails it downstream.
 */
export function reasonerForEnv(ai: AiLike | undefined): Reasoner | undefined {
  if (!ai) return undefined;
  return async (prompt: string): Promise<string> => {
    const out = await ai.run(REASONER_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You are an App Store Optimization analyst. Respond with ONLY the " +
            "requested JSON object — no prose, no markdown fences.",
        },
        { role: "user", content: prompt },
      ],
    });
    return extractText(out);
  };
}
