/**
 * Per-locale metadata draft generation (#78 direction 1, PRD
 * docs/prd/localization/phase-1-engine.md).
 *
 * Turns the APPROVED en-US copy into an honest per-locale DRAFT: the ranking
 * surfaces only (name / subtitle / keyword field, promo when present — never
 * the 4000-char description, which is out of v1 scope), fitted to Apple's
 * limits and validated. The human reviews and approves per market; nothing
 * here writes anywhere.
 *
 * Provider-agnostic: `Localizer` is the seam (Workers AI today, DeepL-ready —
 * the owner-gating decision from the PRD stays reversible).
 *
 * HONESTY RULES (each is a test):
 *   • brand tokens survive translation VERBATIM (placeholder swap + post-check;
 *     a draft that lost the brand is REJECTED, never quietly shipped),
 *   • over-limit translations are trimmed by fitToLimit and REPORTED in
 *     `trimmed` — never silently shipped over-limit,
 *   • any provider failure refuses the WHOLE draft (throws LocalizeError) — no
 *     partial drafts, no en-US text presented as a translation,
 *   • the label is part of the data model: every draft carries the verbatim
 *     "machine-translated" caveat for the UI to render.
 */
import {
  buildKeywordField,
  fitToLimit,
  validateCopy,
  type CopyFields,
  type CopyValidation,
} from "./optimize.js";

/** Provider-agnostic translation seam — Workers AI now, DeepL-ready. */
export type Localizer = (req: {
  text: string;
  /** BCP-47 as App Store Connect uses it, e.g. "de-DE", "ja". */
  targetLocale: string;
  kind: "name" | "subtitle" | "keyword" | "promo";
}) => Promise<string>;

export type LocalizeInput = {
  /** the APPROVED copy (post-edit) — never the unapproved agent draft. */
  copy: CopyFields;
  targetLocale: string;
  /** brand token(s) that must survive verbatim, e.g. ["Mangia"]. */
  brandTokens: string[];
};

export const DRAFT_LABEL = "draft — machine-translated, review before shipping" as const;

export type LocalizedDraft = {
  locale: string;
  copy: CopyFields;
  validation: CopyValidation;
  /** fields that were trimmed to fit their limit — surfaced in the UI. */
  trimmed: string[];
  label: typeof DRAFT_LABEL;
};

/** An honest refusal — the draft could not be produced safely. */
export class LocalizeError extends Error {}

/** Swap brand tokens for placeholders the model is told to preserve. */
function maskBrand(text: string, tokens: string[]): string {
  let out = text;
  tokens.forEach((t, i) => {
    if (!t) return;
    // Case-insensitive, all occurrences; escape regex metachars in the token.
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "gi"), `⟦${i}⟧`);
  });
  return out;
}

/** Restore placeholders to the ORIGINAL brand casing. */
function unmaskBrand(text: string, tokens: string[]): string {
  let out = text;
  tokens.forEach((t, i) => {
    out = out.split(`⟦${i}⟧`).join(t);
  });
  return out;
}

/**
 * Derive the brand token from a name: the segment before the first separator
 * ("Mangia - Recipe Manager" → "Mangia"), or the first word when there is no
 * separator. Callers may override with their own token list.
 */
export function deriveBrandTokens(name: string): string[] {
  const head = name.split(/[-–—:|·]/)[0]?.trim() ?? "";
  if (head && head.length < name.trim().length) return [head];
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first ? [first] : [];
}

export async function localizeCopy(
  localizer: Localizer,
  input: LocalizeInput,
): Promise<LocalizedDraft> {
  const { copy, targetLocale, brandTokens } = input;
  const tokens = brandTokens.map((t) => t.trim()).filter(Boolean);
  const trimmed: string[] = [];

  const translate = async (
    text: string,
    kind: "name" | "subtitle" | "keyword" | "promo",
  ): Promise<string> => {
    const masked = maskBrand(text, tokens);
    let out: string;
    try {
      out = await localizer({ text: masked, targetLocale, kind });
    } catch (e) {
      // Refusal, not degradation: no partial drafts, no en-US-as-translation.
      throw new LocalizeError(
        `translation failed for the ${kind} (${e instanceof Error ? e.message : "provider error"})`,
      );
    }
    return unmaskBrand(out.trim(), tokens);
  };

  const fit = (value: string, field: "name" | "subtitle" | "keywords" | "promo"): string => {
    const fitted = fitToLimit(value, field);
    if (fitted !== value) trimmed.push(field);
    return fitted;
  };

  // name — brand-guarded. A fit that cuts the brand off is a rejection too.
  const name = fit(await translate(copy.name, "name"), "name");
  for (const t of tokens) {
    if (copy.name.toLowerCase().includes(t.toLowerCase()) && !name.toLowerCase().includes(t.toLowerCase())) {
      throw new LocalizeError(
        `the brand token "${t}" did not survive translation — draft rejected (never a translated brand)`,
      );
    }
  }

  // subtitle / promo — only when the source has them (empty stays empty; we
  // never invent copy for a surface the approved proposal left blank).
  const subtitle = copy.subtitle.trim()
    ? fit(await translate(copy.subtitle, "subtitle"), "subtitle")
    : "";
  const promo =
    copy.promo !== undefined && copy.promo.trim()
      ? fit(await translate(copy.promo, "promo"), "promo")
      : undefined;

  // keyword field — term by term, then re-packed against the TRANSLATED
  // surfaces (Apple's no-repeat rule applies per locale). buildKeywordField
  // lowercases, de-dupes, drops collisions, and packs ≤100 — same as en-US.
  const sourceTerms = copy.keywords.split(",").map((t) => t.trim()).filter(Boolean);
  const translatedTerms: string[] = [];
  for (const term of sourceTerms) {
    translatedTerms.push(await translate(term, "keyword"));
  }
  const keywords = buildKeywordField(translatedTerms, { name, subtitle });
  // Report when packing dropped terms (space or per-locale collision) — the
  // reviewer should know the translated set didn't carry over 1:1.
  const packedCount = keywords ? keywords.split(",").length : 0;
  const uniqueTranslated = new Set(
    translatedTerms.map((t) => t.trim().toLowerCase()).filter(Boolean),
  ).size;
  if (packedCount < uniqueTranslated) trimmed.push("keywords");

  const fields: CopyFields = {
    name,
    subtitle,
    keywords,
    ...(promo !== undefined ? { promo } : {}),
    // description deliberately absent — out of v1 scope (unreviewable MT risk).
  };

  return {
    locale: targetLocale,
    copy: fields,
    validation: validateCopy(fields),
    trimmed,
    label: DRAFT_LABEL,
  };
}

/**
 * Phase 2: validate a locale draft SUBMITTED for approval. The client's draft
 * (possibly human-edited — that's the point of the review gate) is a proposal;
 * the server is authoritative. Loud errors, mirroring finalizeEditedCopy's
 * posture: limits + Apple's keyword rules via validateCopy, plus the brand
 * guardrail re-checked against the SOURCE name.
 */
export function validateLocalizedSubmission(input: {
  copy: unknown;
  sourceName: string;
}): { ok: true; copy: CopyFields } | { ok: false; error: string } {
  const c = input.copy;
  if (!c || typeof c !== "object" || Array.isArray(c)) return { ok: false, error: "copy must be an object" };
  const r = c as Record<string, unknown>;
  for (const k of ["name", "subtitle", "keywords"] as const) {
    if (typeof r[k] !== "string") return { ok: false, error: `copy.${k} must be a string` };
  }
  if ("promo" in r && r.promo !== undefined && typeof r.promo !== "string") {
    return { ok: false, error: "copy.promo must be a string" };
  }
  if ("description" in r && r.description !== undefined) {
    return { ok: false, error: "description localization is out of scope — remove it" };
  }
  if (!(r.name as string).trim()) return { ok: false, error: "copy.name must not be empty" };

  const fields: CopyFields = {
    name: r.name as string,
    subtitle: r.subtitle as string,
    keywords: r.keywords as string,
    ...(typeof r.promo === "string" && r.promo.trim() ? { promo: r.promo } : {}),
  };
  const validation = validateCopy(fields);
  if (!validation.pass) {
    const bad = validation.checks.filter((ch) => !ch.ok).map((ch) => `${ch.field}: ${ch.issues.join("; ")}`);
    return { ok: false, error: `invalid copy — ${bad.join(" · ")}` };
  }
  for (const t of deriveBrandTokens(input.sourceName)) {
    if (!fields.name.toLowerCase().includes(t.toLowerCase())) {
      return { ok: false, error: `the brand token "${t}" is missing from the localized name` };
    }
  }
  return { ok: true, copy: fields };
}
