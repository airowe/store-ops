/**
 * Keyword reasoning — "LLM classifies, reality validates" (issue #57).
 *
 * The old path (runConfig.seedKeywordsFromName) tokenized the app TITLE into
 * keyword targets: "Mangia - Recipe Manager" → ["mangia","recipe","manager"].
 * That shipped the brand word ("mangia") and a generic title token ("manager")
 * as targets, and missed the app's real intent (recipe import / pantry / meal
 * planning) because the hard-coded genre map only fired on the literal genre key.
 *
 * This module replaces that with a reasoning step that knows the app: it asks an
 * (injected, provider-agnostic) model to classify each candidate token + suggest
 * a few more targets STRICTLY derived from the description — then GUARDRAILS the
 * model's output against the grounding text so it can never invent a keyword or
 * promote the brand word to a target. On any model error/garbage it degrades to
 * a deterministic classifier that does the same job without an LLM.
 *
 * Pure logic only — the concrete `env.AI`-backed Reasoner lives in the API layer
 * and is injected in, so this whole module unit-tests without a binding.
 */

export type KeywordClass = "brand" | "target" | "drop";

export type ClassifiedKeyword = {
  keyword: string;
  class: KeywordClass;
  reason: string;
};

export type KeywordReasoning = {
  brand: string[];
  target: string[];
  dropped: string[];
};

/** The LLM-facing interface — provider-agnostic so tests inject a fake. */
export type Reasoner = (prompt: string) => Promise<string>; // returns raw model text

export type ReasonerInputs = {
  appName: string;
  description: string;
  candidateTokens: string[];
};

/**
 * Genre → category intent seeds. Borrowed from runConfig.GENRE_SEEDS, but here we
 * scan the DESCRIPTION (what the app does) instead of only the name, so a title
 * like "Recipe Manager" that lacks the literal "food" key still loads food intent.
 * The keys are the trigger words to look for; the values are the intent set.
 */
const GENRE_SEEDS: Record<string, string[]> = {
  meditation: ["meditation", "mindfulness", "calm", "stoic", "sleep", "anxiety"],
  mindfulness: ["meditation", "mindfulness", "wellness", "calm", "sleep"],
  recipe: ["recipe", "meal", "cooking", "grocery", "pantry", "meal planner"],
  cooking: ["recipe", "meal", "cooking", "grocery", "pantry", "meal planner"],
  pantry: ["recipe", "meal", "cooking", "grocery", "pantry", "meal planner"],
  grocery: ["recipe", "meal", "cooking", "grocery", "pantry", "meal planner"],
  meal: ["recipe", "meal", "cooking", "grocery", "pantry", "meal planner"],
  photo: ["photo editor", "filter", "collage", "camera", "edit"],
  budget: ["budget", "expense", "money", "savings", "track"],
  expense: ["budget", "expense", "money", "savings", "track"],
  habit: ["habit", "journal", "focus", "routine", "streak"],
  workout: ["workout", "fitness", "exercise", "gym", "training"],
  fitness: ["workout", "fitness", "exercise", "gym", "training"],
  weather: ["weather", "forecast", "radar", "rain", "temperature"],
};

/** Words that are never useful keyword seeds (generic store/marketing fluff). */
const STOP = new Set([
  "the", "and", "for", "your", "app", "free", "pro", "lite", "best", "new",
  "with", "manager", "tracker", "tool", "kit", "plus", "suite",
]);

/** A term is junk when every one of its words is a generic stopword. */
function isStopTerm(term: string): boolean {
  const parts = words(term);
  return parts.length > 0 && parts.every((p) => STOP.has(p));
}

/** Lowercase + split a string into alpha-numeric words ≥ 3 chars. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
}

/**
 * The brand segment of a title is the part BEFORE the first separator
 * (" - ", ":", "|", "–", "—"). Apple already ranks the title for these words, so
 * they're monitor-only. "Mangia - Recipe Manager" → brand segment "Mangia".
 * A title with no separator (e.g. "Pantry Pro") is treated as all-brand: there's
 * no descriptive tail to mine, so every word is the brand.
 */
function brandSegment(appName: string): string {
  const m = appName.split(/\s[-:|–—]\s|[:|]/);
  return (m[0] ?? appName).trim() || appName;
}

/** The set of brand words — anything here is brand, monitor-only. */
function brandWords(appName: string): Set<string> {
  return new Set(words(brandSegment(appName)));
}

/**
 * Is `term` substantiated by the grounding text? Every word of `term` (terms may
 * be multi-word, e.g. "meal planner") must appear as a stem/substring of some
 * grounding word, OR contain a grounding word as a substring. This is the core
 * anti-invention check: a target the model returns whose words aren't in the
 * description/name is a hallucination and gets dropped.
 */
function isSubstantiated(term: string, grounding: Set<string>): boolean {
  const parts = words(term);
  if (parts.length === 0) return false;
  return parts.every((part) =>
    [...grounding].some((g) => g.includes(part) || part.includes(g)),
  );
}

/** Normalize a keyword to its compared form (trimmed, lowercased, collapsed ws). */
function norm(k: string): string {
  return k.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Dedupe while preserving order. */
function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    if (!i || seen.has(i)) continue;
    seen.add(i);
    out.push(i);
  }
  return out;
}

/**
 * Scan the DESCRIPTION (and name as a fallback) for any genre trigger word and
 * return the union of the matched intent sets. This is what makes "Recipe
 * Manager" load food intent even though the title never says "food".
 */
function detectGenreSeeds(inputs: ReasonerInputs): string[] {
  const haystack = `${inputs.description} ${inputs.appName}`.toLowerCase();
  const out: string[] = [];
  for (const [trigger, seeds] of Object.entries(GENRE_SEEDS)) {
    if (haystack.includes(trigger)) out.push(...seeds);
  }
  return uniq(out);
}

/**
 * Deterministic fallback (NO LLM) — also the default when a reasoner is absent.
 * - appName words → brand (monitor-only).
 * - description-substantiated candidate tokens → target.
 * - everything else → drop.
 * - then fold in genre intent seeds scanned from the DESCRIPTION, excluding any
 *   brand word or junk stopword.
 */
export function classifyDeterministic(inputs: ReasonerInputs): KeywordReasoning {
  const brandSet = brandWords(inputs.appName);

  const brand: string[] = [];
  const target: string[] = [];
  const dropped: string[] = [];

  for (const raw of inputs.candidateTokens) {
    const tok = norm(raw);
    if (!tok) continue;
    if (brandSet.has(tok)) {
      brand.push(tok);
      continue;
    }
    // Substantiated by the DESCRIPTION specifically (not just the title) and not
    // a generic junk word → a real target. A title-only token like "manager"
    // (in STOP, and absent from the description) falls through to drop.
    const inDescription = isSubstantiated(tok, new Set(words(inputs.description)));
    if (inDescription && !isStopTerm(tok)) {
      target.push(tok);
    } else {
      dropped.push(tok);
    }
  }

  // Fold in genre intent seeds — the genre trigger in the description IS the
  // substantiation, so the whole intent set rides in; we only exclude a brand
  // word or a junk stopword. (e.g. "cooking" loads for a recipe app even if the
  // literal word "cooking" isn't in the description.)
  for (const seed of detectGenreSeeds(inputs)) {
    const s = norm(seed);
    if (!s || brandSet.has(s) || STOP.has(s)) continue;
    target.push(s);
  }

  return {
    brand: uniq(brand),
    target: uniq(target.filter((t) => !brandSet.has(t))),
    dropped: uniq(dropped),
  };
}

/** The strict JSON shape we ask the model for. */
type ModelShape = { brand: string[]; target: string[]; drop: string[] };

/**
 * Extract the first balanced JSON object from raw model text (prose, markdown
 * fences, or trailing chatter around it are all tolerated). Returns null if no
 * parseable object is found.
 */
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function asModelShape(v: unknown): ModelShape | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isStringArray(o.brand) || !isStringArray(o.target) || !isStringArray(o.drop)) {
    return null;
  }
  return { brand: o.brand, target: o.target, drop: o.drop };
}

/**
 * Pure: parse the model's raw JSON text + GUARDRAIL it against the grounding
 * inputs. The model's classification is advisory; reality (the description +
 * appName) is binding:
 *   1. No invention — every target word must be substantiated by the description
 *      OR appName, else the target is DROPPED.
 *   2. Brand lane — any candidate token that is an appName word is forced to
 *      brand, regardless of what the model said.
 *   3. Junk drop — anything neither brand nor substantiated-intent → dropped.
 * Throws on unparseable/invalid model output (the orchestrator catches → falls
 * back to the deterministic classifier).
 */
export function reconcileReasoning(
  rawModelText: string,
  inputs: ReasonerInputs,
): KeywordReasoning {
  const parsed = asModelShape(extractJson(rawModelText));
  if (!parsed) throw new Error("model output did not match the expected schema");

  const brandSet = brandWords(inputs.appName);
  const grounding = new Set<string>([
    ...words(inputs.description),
    ...words(inputs.appName),
  ]);

  const brand: string[] = [];
  const target: string[] = [];
  const dropped: string[] = [];

  // Brand-lane: the model's brand list PLUS any appName word it put elsewhere.
  for (const b of parsed.brand) {
    const t = norm(b);
    if (t && brandSet.has(t)) brand.push(t);
  }

  // Targets: substantiated + not-brand survive; the rest are dropped.
  for (const t of parsed.target) {
    const term = norm(t);
    if (!term) continue;
    if (brandSet.has(term)) {
      brand.push(term); // guardrail 2: brand wins over the model's "target".
      continue;
    }
    // guardrail 3: a generic junk word (e.g. "manager") is never a target, even
    // if it appears in the title — it's not a real search intent.
    if (isStopTerm(term)) {
      dropped.push(term);
      continue;
    }
    if (isSubstantiated(term, grounding)) {
      target.push(term); // guardrail 1: substantiated → ship.
    } else {
      dropped.push(term); // guardrail 1: hallucinated → drop, never ship.
    }
  }

  // The model's own drops (and any candidate it forgot) are recorded as dropped,
  // except brand words, which belong in the brand lane.
  for (const d of parsed.drop) {
    const term = norm(d);
    if (!term) continue;
    if (brandSet.has(term)) brand.push(term);
    else dropped.push(term);
  }

  // Sweep the candidate tokens: every candidate must be accounted for, even if
  // the model omitted it. A brand-word candidate the model forgot still belongs
  // in the brand lane; any other unclassified candidate is dropped.
  const placed = new Set<string>([...brand, ...target, ...dropped]);
  for (const c of inputs.candidateTokens) {
    const term = norm(c);
    if (!term || placed.has(term)) continue;
    placed.add(term);
    if (brandSet.has(term)) brand.push(term);
    else dropped.push(term);
  }

  const brandFinal = uniq(brand);
  const targetFinal = uniq(target.filter((t) => !brandFinal.includes(t)));
  const droppedFinal = uniq(
    dropped.filter((d) => !brandFinal.includes(d) && !targetFinal.includes(d)),
  );

  return { brand: brandFinal, target: targetFinal, dropped: droppedFinal };
}

/**
 * Build the model prompt: classify each candidate token + suggest up to ~6 more
 * target keywords STRICTLY derived from the description, and return ONLY the
 * strict JSON object. The reconciler guardrails the output regardless, but a
 * tight prompt keeps the model honest in the first place.
 */
export function buildPrompt(inputs: ReasonerInputs): string {
  return [
    "You are an App Store Optimization analyst. Classify keyword candidates for an app.",
    "",
    `App name: ${inputs.appName}`,
    `App description: ${inputs.description}`,
    `Candidate tokens (from the title): ${JSON.stringify(inputs.candidateTokens)}`,
    "",
    "Rules:",
    '- "brand": tokens that are the app\'s own name/brand (monitor-only, never a search target).',
    '- "target": real search terms a user would type to FIND this app, derived ONLY from what the',
    "  description says the app DOES. Drop generic title tokens (e.g. 'manager', 'tracker') unless",
    "  they are genuinely a search term for this app.",
    '- "drop": generic/junk tokens that are neither brand nor a real search intent.',
    "- You MAY add up to 6 additional target keywords, but ONLY ones strictly supported by the",
    "  description. Do NOT invent features the description does not mention.",
    "",
    'Return ONLY a JSON object: {"brand":[],"target":[],"drop":[]} — no prose, no markdown.',
  ].join("\n");
}

/**
 * Orchestrator: build the prompt, call the reasoner, reconcile (guardrail) the
 * output. On ANY error — reasoner throws, output unparseable, schema mismatch —
 * fall back to the deterministic classifier. Never throws. When no reasoner is
 * given, runs deterministic-only.
 */
export async function reasonKeywords(
  inputs: ReasonerInputs,
  reasoner?: Reasoner,
): Promise<KeywordReasoning> {
  if (!reasoner) return classifyDeterministic(inputs);
  try {
    const raw = await reasoner(buildPrompt(inputs));
    return reconcileReasoning(raw, inputs);
  } catch {
    return classifyDeterministic(inputs);
  }
}
