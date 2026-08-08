/**
 * The concrete Reasoner backends (#57 → Claude upgrade). This is the ONE place
 * that touches an LLM provider — kept out of the engine so the reasoning logic
 * (keywordReasoner.ts, copyAuthor.ts, reviewSentiment, screenshotPlanner) stays
 * pure and fully unit-testable with an injected fake.
 *
 * Backend priority, decided by `reasonerBackend`:
 *   1. `ANTHROPIC_API_KEY` set → Claude (the deliberate choice — a paid secret
 *      someone configured on purpose).
 *   2. `env.AI` binding present → Workers AI Llama (ambient, ~free).
 *   3. Neither → undefined, and every downstream consumer degrades to its
 *      deterministic path.
 *
 * The degradation contract is unchanged from the Llama-only era: a Reasoner
 * returns RAW model text; downstream parsers treat empty/garbage as "fall back
 * deterministically" and CATCH thrown errors. So a Claude safety refusal maps
 * to "" (never a half-answer), and API errors are allowed to throw. A missing
 * or failing backend NEVER breaks a run.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Reasoner } from "../engine/keywordReasoner.js";

/** Claude model for reasoning/authoring. Overridable via env.ANTHROPIC_MODEL. */
const DEFAULT_CLAUDE_MODEL = "claude-opus-5";

/** The text-generation model used on the Workers AI fallback path. */
const REASONER_MODEL = "@cf/meta/llama-3.1-8b-instruct";

/** Both backends share the same output contract downstream parsers rely on. */
const SYSTEM_PROMPT =
  "You are an App Store Optimization analyst. Respond with ONLY the " +
  "requested JSON object — no prose, no markdown fences.";

/** Minimal structural type for the Workers AI binding. */
type AiLike = { run(model: string, input: unknown): Promise<unknown> };

/** The env slice the selector reads — structurally satisfied by the Worker Env. */
export type ReasonerEnv = {
  AI?: AiLike;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
};

/**
 * Minimal structural slice of the SDK's messages.create — injected so the
 * Claude reasoner unit-tests without a client or network.
 */
type MessagesCreate = (params: {
  model: string;
  max_tokens: number;
  system: string;
  output_config: { effort: "low" };
  messages: Array<{ role: "user"; content: string }>;
}) => Promise<{ stop_reason: string | null; content: unknown }>;

/** Pull the concatenated text blocks out of a Messages API response. */
function claudeText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
      const t = (block as { text?: unknown }).text;
      if (typeof t === "string") out += t;
    }
  }
  return out;
}

/**
 * Build a Reasoner over an injected Claude messages-create fn. Effort "low":
 * this backs classification and short authoring calls that run inside every
 * sweep — routine work, and the guardrails downstream do the validating.
 * `stop_reason: "refusal"` → "" so the caller's deterministic fallback takes
 * over instead of a half-answer.
 */
export function claudeReasoner(create: MessagesCreate, model: string): Reasoner {
  return async (prompt: string): Promise<string> => {
    const res = await create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: prompt }],
    });
    if (res.stop_reason === "refusal") return "";
    return claudeText(res.content);
  };
}

/**
 * Pull the assistant's text out of a Workers AI text-generation response,
 * defensively (an SDK shape change must not throw inside the run path).
 */
function extractText(out: unknown): string {
  if (typeof out === "string") return out;
  if (out && typeof out === "object" && "response" in out) {
    const r = (out as { response?: unknown }).response;
    if (typeof r === "string") return r;
  }
  return "";
}

function workersAiReasoner(ai: AiLike): Reasoner {
  return async (prompt: string): Promise<string> => {
    const out = await ai.run(REASONER_MODEL, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    });
    return extractText(out);
  };
}

/** The pure backend decision — exported so the priority is spec-enforced. */
export function reasonerBackend(env: ReasonerEnv | undefined): "claude" | "workers-ai" | "none" {
  if (env?.ANTHROPIC_API_KEY?.trim()) return "claude";
  if (env?.AI) return "workers-ai";
  return "none";
}

/**
 * Build the best available Reasoner for this environment, or undefined when
 * none is configured (deterministic classifiers take over downstream).
 */
export function reasonerForEnv(env: ReasonerEnv | undefined): Reasoner | undefined {
  switch (reasonerBackend(env)) {
    case "claude": {
      const client = new Anthropic({ apiKey: env!.ANTHROPIC_API_KEY!.trim() });
      const model = env!.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
      return claudeReasoner(
        (params) => client.messages.create(params) as ReturnType<MessagesCreate>,
        model,
      );
    }
    case "workers-ai":
      return workersAiReasoner(env!.AI!);
    case "none":
      return undefined;
  }
}
