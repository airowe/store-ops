/**
 * Screenshot planner — the LLM half of ShipShots (#153): audit findings +
 * listing metadata + the raw captured screens → a schema-validated
 * `ScreenshotPlan` that the deterministic renderer (lib/render_localized_shots.py
 * / the template library) turns into pixels.
 *
 * "The LLM never paints pixels" (the issue's design principle). The model only
 * PLANS — narrative, per-shot headline, which raw screen backs it, which
 * template — and every field it returns is GUARDRAILED here against the grounding
 * inputs so it can never:
 *   • ship a headline longer than 6 words or an unmeasured claim ("#1", "best"),
 *   • back a shot with a screen that was never captured (→ MISSING, honest gap),
 *   • pick a template outside the fixed library, or an accent off the brand palette.
 *
 * Same shape as keywordReasoner.ts: pure logic over an injected, provider-agnostic
 * `Reasoner` seam (the concrete env.AI reasoner lives in the API layer), so this
 * whole module unit-tests without a binding, and on ANY model error/garbage it
 * degrades to a deterministic plan that does the same job without an LLM.
 */

/** The fixed template library — the renderer knows exactly these; nothing else. */
export const TEMPLATE_IDS = ["headline-top", "headline-bottom", "full-bleed", "duo"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** Verbatim draft caveat, mirroring localizeCopy.ts DRAFT_LABEL. */
export const PLAN_DRAFT_LABEL = "draft — machine-planned, review before shipping" as const;

export type Grade = "A" | "B" | "C" | "D" | "F" | "?";

export type PlannerInputs = {
  appName: string;
  subtitle?: string;
  keywords: string[];
  /** the raw captured screen ids the renderer can actually source a shot from. */
  rawScreens: string[];
  audit: {
    grade: Grade;
    /** how many shots to ship (from the audit / best practice). */
    recommendedCount: number;
    /** the audit's findings — what the plan is a FIX for, not generic styling. */
    findings: string[];
  };
  /** the fixed brand palette; accents must come from here, never free-form. */
  brandPalette: string[];
};

export type PlannedShot = {
  /** a real rawScreen id, or "MISSING" (honest gap — never a fabricated screen). */
  sourceScreen: string;
  /** why this shot is MISSING (only set when sourceScreen === "MISSING"). */
  missingReason?: string;
  headline: string;
  subline?: string;
  templateId: TemplateId;
  accent?: string;
  /** true when the headline failed the lint — flagged for review, not dropped. */
  needsReview?: boolean;
  headlineIssue?: string;
};

export type ScreenshotPlan = {
  narrative: string;
  shots: PlannedShot[];
  label: typeof PLAN_DRAFT_LABEL;
  /** true when this came from the deterministic fallback, not the model. */
  degraded: boolean;
};

/** The LLM-facing interface — provider-agnostic so tests inject a fake. */
export type Reasoner = (prompt: string) => Promise<string>;

// ── headline lint (the honesty guard) ────────────────────────────────────────
const MAX_HEADLINE_WORDS = 6;

/** Unmeasured superlatives / rank claims we never ship on a generated shot. */
const UNMEASURED_CLAIM = /(^|\b)(#\s?1|no\.?\s?1|number\s+one|the\s+best|best\b|#1)\b/i;

export type LintResult = { ok: boolean; reason?: string };

/** A headline must be non-empty, ≤ 6 words, and free of unmeasured claims. */
export function lintHeadline(headline: string): LintResult {
  const h = headline.trim();
  if (h === "") return { ok: false, reason: "empty headline" };
  const wordCount = h.split(/\s+/).length;
  if (wordCount > MAX_HEADLINE_WORDS) {
    return { ok: false, reason: `headline is ${wordCount} words — cap is ${MAX_HEADLINE_WORDS} words` };
  }
  if (UNMEASURED_CLAIM.test(h)) {
    return { ok: false, reason: "unmeasured claim (e.g. \"#1\"/\"best\") — not shippable without proof" };
  }
  return { ok: true };
}

/** Extract the first balanced JSON object from raw model text (mirrors
 *  keywordReasoner's extractor: models sometimes wrap JSON in prose/fences). */
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === "\\") i++;
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

function coerceTemplate(id: unknown): TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(id as string)
    ? (id as TemplateId)
    : "headline-top"; // the safe default when the model invents a template
}

/**
 * Validate & guardrail a model plan against the grounding inputs. Throws on
 * unparseable / structurally-invalid output so the orchestrator catches it and
 * falls back to the deterministic plan (mirrors reconcileReasoning's posture).
 */
export function reconcilePlan(raw: string, inputs: PlannerInputs): ScreenshotPlan {
  const parsed = extractJson(raw) as { narrative?: unknown; shots?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.shots) || parsed.shots.length === 0) {
    throw new Error("planner returned no valid shots");
  }
  const realScreens = new Set(inputs.rawScreens);
  const palette = inputs.brandPalette;

  const shots: PlannedShot[] = parsed.shots.map((s): PlannedShot => {
    const r = (s ?? {}) as Record<string, unknown>;
    const rawSource = typeof r.sourceScreen === "string" ? r.sourceScreen : "MISSING";

    // A shot must be backed by a REAL captured screen. "MISSING" the model
    // declared itself is kept as an honest gap; a source the model invented is
    // demoted to MISSING with a reason — never passed off as a real screen.
    let sourceScreen = rawSource;
    let missingReason: string | undefined;
    if (rawSource === "MISSING") {
      missingReason = typeof r.subline === "string" ? r.subline : "no captured screen for this shot";
    } else if (!realScreens.has(rawSource)) {
      sourceScreen = "MISSING";
      missingReason = `"${rawSource}" was never captured — capture it or drop this shot`;
    }

    const headline = typeof r.headline === "string" ? r.headline.trim() : "";
    const lint = lintHeadline(headline);

    // accent must be a real brand-palette color; a free-form one is replaced.
    let accent = typeof r.accent === "string" ? r.accent : undefined;
    if (accent && !palette.includes(accent)) accent = palette[0];

    return {
      sourceScreen,
      ...(missingReason ? { missingReason } : {}),
      headline,
      ...(typeof r.subline === "string" && sourceScreen !== "MISSING" ? { subline: r.subline } : {}),
      templateId: coerceTemplate(r.templateId),
      ...(accent ? { accent } : {}),
      // a bad headline is FLAGGED for review, never silently shipped as-is.
      ...(lint.ok ? {} : { needsReview: true, headlineIssue: lint.reason }),
    };
  });

  return {
    narrative: typeof parsed.narrative === "string" ? parsed.narrative : "",
    shots,
    label: PLAN_DRAFT_LABEL,
    degraded: false,
  };
}

/**
 * Deterministic fallback (NO LLM) — also the default when a reasoner is absent.
 * Produces recommendedCount shots grounded in the real raw screens: a benefit
 * headline derived from the subtitle/first finding, cycling the templates, any
 * shot beyond the available screens honestly emitted as MISSING. Never invents a
 * screen or a claim.
 */
export function planDeterministic(inputs: PlannerInputs): ScreenshotPlan {
  const n = Math.max(1, inputs.audit.recommendedCount);
  const lead = ((inputs.subtitle ?? inputs.appName).split(/[-–—:|]/)[0] ?? "").trim();
  const shots: PlannedShot[] = [];
  for (let i = 0; i < n; i++) {
    const src = inputs.rawScreens[i];
    // i % length is always in range, so this element is defined.
    const template = TEMPLATE_IDS[i % TEMPLATE_IDS.length] as TemplateId;
    if (src) {
      // keep the headline within lint bounds (≤6 words), benefit-first on shot 1.
      const words = (i === 0 ? lead : inputs.keywords[i % inputs.keywords.length] ?? lead)
        .split(/\s+/).slice(0, MAX_HEADLINE_WORDS).join(" ");
      shots.push({ sourceScreen: src, headline: words || lead, templateId: template });
    } else {
      shots.push({
        sourceScreen: "MISSING",
        missingReason: `only ${inputs.rawScreens.length} screens captured; shot ${i + 1} needs one more`,
        headline: "",
        templateId: template,
        needsReview: true,
        headlineIssue: "no source screen — capture or remove",
      });
    }
  }
  return {
    narrative: `Best-practice structure for ${inputs.appName}: lead with the benefit, then proof.`,
    shots,
    label: PLAN_DRAFT_LABEL,
    degraded: true,
  };
}

/** Build the planner prompt — grounded strictly in the inputs. */
export function buildPrompt(inputs: PlannerInputs): string {
  return [
    "You plan an App Store screenshot set. Reply with ONLY a JSON object:",
    '{"narrative": string, "shots": [{"sourceScreen": string, "headline": string, "subline"?: string, "templateId": string, "accent"?: string}]}',
    `Plan exactly ${inputs.audit.recommendedCount} shots. First shot is the hook.`,
    `Each sourceScreen MUST be one of: ${JSON.stringify(inputs.rawScreens)}, or "MISSING" if none fits.`,
    `templateId MUST be one of: ${JSON.stringify(TEMPLATE_IDS)}.`,
    `accent (optional) MUST be one of: ${JSON.stringify(inputs.brandPalette)}.`,
    "Headlines: ≤ 6 words, benefit-first, NO unmeasured claims (no \"#1\", no \"best\").",
    `App: ${inputs.appName}${inputs.subtitle ? " — " + inputs.subtitle : ""}`,
    `Keywords: ${inputs.keywords.join(", ")}`,
    `The plan must FIX these audit findings (grade ${inputs.audit.grade}):`,
    ...inputs.audit.findings.map((f) => `- ${f}`),
  ].join("\n");
}

/**
 * Plan a screenshot set over an injected Reasoner. On any model error or garbage
 * output, degrade to the deterministic plan — honestly marked `degraded: true`.
 */
export async function planScreenshots(
  inputs: PlannerInputs,
  reasoner?: Reasoner,
): Promise<ScreenshotPlan> {
  if (!reasoner) return planDeterministic(inputs);
  try {
    const raw = await reasoner(buildPrompt(inputs));
    return reconcilePlan(raw, inputs);
  } catch {
    return planDeterministic(inputs);
  }
}
