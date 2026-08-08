/**
 * Claude-authored subtitle candidates — "LLM writes, reality validates".
 *
 * The deterministic composer (optimize.composeSubtitle) joins scored terms into
 * a phrase; it is honest but it is not a copywriter. This module asks an
 * injected Reasoner (Claude when configured — api/aiReasoner.ts) to WRITE a
 * subtitle, then guardrails the output with the same distrust the keyword
 * path established (#57):
 *
 *   • hard char limit (CHAR_LIMITS.subtitle) — over-limit is rejected, never
 *     truncated: a chopped sentence is worse copy than the composed fallback;
 *   • no brand words (#42: Apple already ranks the title — repeating it burns
 *     the 30-char surface for zero gain);
 *   • no price/"free" claims (the 2.3.7 class that already cost a rejection);
 *   • must carry at least one target keyword's word — this surface exists to
 *     rank, not just to read well;
 *   • must be a real phrase (≥ 2 words — the same bar isStrongSubtitle sets).
 *
 * ANY failure — reasoner error, garbage output, guardrail miss — returns null
 * and the caller keeps the deterministic composition. Authored copy is a
 * candidate, never a requirement.
 */
import { CHAR_LIMITS } from "./constants.js";
import type { Reasoner } from "./keywordReasoner.js";

export type AuthorSubtitleInputs = {
  appName: string;
  /** The app's real description — the grounding text the copy may draw on. */
  description: string;
  /** Scored target keywords, best first — at least one must surface in the copy. */
  targets: string[];
};

/** Bound the prompt: enough description to ground the copy, not the whole 4000. */
const DESCRIPTION_CAP = 1500;

/** Price-claim words that have no place in store copy (2.3.7 class). */
const PRICE_CLAIMS = /\b(free|sale|discount|cheap(est)?|\d+% ?off)\b|[$€£]/i;

/**
 * Normalize for word-set comparison: lowercase, strip punctuation, and fold a
 * plain plural ("recipes" → "recipe") — natural copy pluralizes, and both the
 * brand ban and the target-carry check should see through that.
 */
function normWord(w: string): string {
  const bare = w.toLowerCase().replace(/[^a-z0-9]/g, "");
  return bare.length > 3 && bare.endsWith("s") && !bare.endsWith("ss") ? bare.slice(0, -1) : bare;
}

function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .split(/\s+/)
      .map(normWord)
      .filter(Boolean),
  );
}

export function buildSubtitlePrompt(inputs: AuthorSubtitleInputs): string {
  const description = inputs.description.slice(0, DESCRIPTION_CAP);
  return [
    `Write an App Store subtitle for the app "${inputs.appName}".`,
    "",
    "Rules:",
    `- At most ${CHAR_LIMITS.subtitle} characters. This is a hard limit.`,
    "- A natural, benefit-led phrase — not a comma list of keywords.",
    `- Do not use any word from the app name ("${inputs.appName}").`,
    "- Include at least one of these target keywords naturally: " +
      inputs.targets.join(", "),
    "- Only claim things the description below actually supports.",
    '- Never mention price, "free", sales, or discounts.',
    "",
    "App description:",
    description,
    "",
    'Respond with ONLY this JSON object: {"subtitle": "..."}',
  ].join("\n");
}

/** Parse the model's JSON (tolerating markdown fences) → subtitle string | null. */
function parseSubtitle(raw: string): string | null {
  const stripped = raw.replace(/```(?:json)?/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as { subtitle?: unknown };
    return typeof parsed.subtitle === "string" ? parsed.subtitle : null;
  } catch {
    return null;
  }
}

/**
 * The guardrail, exported for direct testing: a candidate subtitle passes only
 * if it obeys every rule the prompt stated. The model is asked nicely; this is
 * what actually enforces it.
 */
export function validateAuthoredSubtitle(
  candidate: string,
  inputs: Pick<AuthorSubtitleInputs, "appName" | "targets">,
): string | null {
  const subtitle = candidate.trim().replace(/\s+/g, " ");
  if (!subtitle) return null;
  if (subtitle.length > CHAR_LIMITS.subtitle) return null;
  if (subtitle.split(" ").length < 2) return null;
  if (PRICE_CLAIMS.test(subtitle)) return null;

  const subtitleWords = wordsOf(subtitle);
  for (const brandWord of wordsOf(inputs.appName)) {
    if (subtitleWords.has(brandWord)) return null;
  }

  const targetWords = new Set(inputs.targets.flatMap((t) => [...wordsOf(t)]));
  let carriesTarget = false;
  for (const w of subtitleWords) {
    if (targetWords.has(w)) {
      carriesTarget = true;
      break;
    }
  }
  return carriesTarget ? subtitle : null;
}

/**
 * Ask the reasoner for a subtitle and validate it. Returns the validated
 * subtitle, or null on any failure (the caller composes deterministically).
 * Never throws. With no targets there is nothing to rank for — returns null
 * without spending a model call.
 */
export async function authorSubtitle(
  reasoner: Reasoner,
  inputs: AuthorSubtitleInputs,
): Promise<string | null> {
  if (inputs.targets.length === 0) return null;
  let raw: string;
  try {
    raw = await reasoner(buildSubtitlePrompt(inputs));
  } catch {
    return null;
  }
  const candidate = parseSubtitle(raw);
  if (candidate === null) return null;
  return validateAuthoredSubtitle(candidate, inputs);
}
