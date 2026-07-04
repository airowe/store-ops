import { describe, expect, it } from "vitest";
import {
  DRAFT_LABEL,
  LocalizeError,
  deriveBrandTokens,
  localizeCopy,
  type Localizer,
} from "./localizeCopy.js";
import { CHAR_LIMITS } from "./constants.js";

/**
 * Localization Phase 1 (#78) — the guardrails, each from the PRD:
 * brand survival, term-by-term keyword packing, trim reporting, refusal on
 * provider failure, description absent, empty-source honesty.
 */

/** A deterministic fake localizer: tags text with the locale; placeholders survive. */
const tagging: Localizer = async ({ text, targetLocale, kind }) => {
  if (kind === "keyword") return `${text}-${targetLocale.slice(0, 2)}`;
  return `${text} [${targetLocale}]`;
};

const BASE = {
  name: "Mangia - Recipe Manager",
  subtitle: "Cook with what you have",
  keywords: "meal planner,grocery list,pantry",
};

describe("deriveBrandTokens", () => {
  it("takes the segment before the first separator", () => {
    expect(deriveBrandTokens("Mangia - Recipe Manager")).toEqual(["Mangia"]);
    expect(deriveBrandTokens("Calm: Sleep & Meditation")).toEqual(["Calm"]);
  });
  it("falls back to the first word when there is no separator", () => {
    expect(deriveBrandTokens("Mangia Recipe Manager")).toEqual(["Mangia"]);
    expect(deriveBrandTokens("")).toEqual([]);
  });
});

describe("localizeCopy — guardrails", () => {
  it("produces a fitted, validated draft with the verbatim honesty label", async () => {
    const draft = await localizeCopy(tagging, {
      copy: BASE,
      targetLocale: "de-DE",
      brandTokens: ["Mangia"],
    });
    expect(draft.locale).toBe("de-DE");
    expect(draft.label).toBe(DRAFT_LABEL);
    expect(draft.copy.name).toContain("Mangia"); // brand survived
    expect(draft.copy.name.length).toBeLessThanOrEqual(CHAR_LIMITS.name);
    expect(draft.copy.keywords.length).toBeLessThanOrEqual(CHAR_LIMITS.keywords);
    expect(draft.validation.pass).toBe(true);
  });

  it("BRAND: the token survives translation even when the provider mangles text around it", async () => {
    // this localizer would translate everything — only the mask protects the brand
    const aggressive: Localizer = async ({ text }) => text.replace(/[A-Za-z]+/g, (w) => (w.startsWith("⟦") ? w : `X${w}X`));
    const draft = await localizeCopy(aggressive, {
      copy: BASE,
      targetLocale: "ja",
      brandTokens: ["Mangia"],
    });
    expect(draft.copy.name).toContain("Mangia");
    expect(draft.copy.name).not.toMatch(/XMangiaX/);
  });

  it("BRAND: a draft that loses the token is REJECTED, never shipped", async () => {
    const eatsPlaceholders: Localizer = async () => "Kochbuch und Essensplaner"; // drops ⟦0⟧
    await expect(
      localizeCopy(eatsPlaceholders, { copy: BASE, targetLocale: "de-DE", brandTokens: ["Mangia"] }),
    ).rejects.toThrow(LocalizeError);
  });

  it("REFUSAL: any provider failure rejects the whole draft — no partial output", async () => {
    let calls = 0;
    const flaky: Localizer = async ({ text }) => {
      calls++;
      if (calls === 3) throw new Error("provider 500");
      return text;
    };
    await expect(
      localizeCopy(flaky, { copy: BASE, targetLocale: "fr-FR", brandTokens: [] }),
    ).rejects.toThrow(/translation failed/);
  });

  it("LIMITS: an over-limit translation is trimmed AND reported", async () => {
    const verbose: Localizer = async ({ text, kind }) =>
      kind === "keyword" ? text : text + " — eine sehr lange wortreiche Übersetzung die niemals passt";
    const draft = await localizeCopy(verbose, {
      copy: BASE,
      targetLocale: "de-DE",
      brandTokens: ["Mangia"],
    });
    expect(draft.copy.subtitle.length).toBeLessThanOrEqual(CHAR_LIMITS.subtitle);
    expect(draft.trimmed).toContain("subtitle");
  });

  it("KEYWORDS: translated term-by-term and re-packed against the TRANSLATED surfaces", async () => {
    // translate 'pantry' into a word that collides with the translated subtitle
    const colliding: Localizer = async ({ text, kind, targetLocale }) => {
      if (kind === "keyword") return text === "pantry" ? "vorrat" : `${text}-de`;
      if (kind === "subtitle") return "Koche mit deinem Vorrat";
      return `${text} [${targetLocale}]`;
    };
    const draft = await localizeCopy(colliding, {
      copy: BASE,
      targetLocale: "de-DE",
      brandTokens: ["Mangia"],
    });
    const terms = draft.copy.keywords.split(",");
    expect(terms).not.toContain("vorrat"); // per-locale no-repeat rule enforced
    expect(draft.trimmed).toContain("keywords"); // the drop is reported
  });

  it("EMPTY SOURCES: blank subtitle stays blank; the provider is never asked to invent", async () => {
    const calls: string[] = [];
    const recording: Localizer = async ({ text, kind }) => {
      calls.push(kind);
      return text;
    };
    const draft = await localizeCopy(recording, {
      copy: { name: "Zen", subtitle: "", keywords: "focus" },
      targetLocale: "ja",
      brandTokens: ["Zen"],
    });
    expect(draft.copy.subtitle).toBe("");
    expect(calls).not.toContain("subtitle");
  });

  it("DESCRIPTION: never part of the draft (out of v1 scope)", async () => {
    const draft = await localizeCopy(tagging, {
      copy: { ...BASE, description: "A long description that must not be translated." },
      targetLocale: "de-DE",
      brandTokens: ["Mangia"],
    });
    expect(draft.copy.description).toBeUndefined();
  });
});

// ── Phase 2: server-side re-validation of a submitted locale draft ────────────

import { validateLocalizedSubmission } from "./localizeCopy.js";

describe("validateLocalizedSubmission (#78 Phase 2)", () => {
  const SOURCE = "Mangia - Recipe Manager";
  const GOOD = { name: "Mangia - Rezept Manager", subtitle: "Koche mit Vorrat", keywords: "essensplan,einkaufsliste" };

  it("accepts a valid edited draft", () => {
    expect(validateLocalizedSubmission({ copy: GOOD, sourceName: SOURCE })).toEqual({ ok: true, copy: GOOD });
  });

  it("rejects non-objects, wrong types, empty name — loudly", () => {
    for (const bad of [null, [], "x", { ...GOOD, name: 5 }, { ...GOOD, name: "  " }]) {
      expect(validateLocalizedSubmission({ copy: bad, sourceName: SOURCE }).ok).toBe(false);
    }
  });

  it("rejects over-limit and rule-breaking copy (server authoritative)", () => {
    const over = { ...GOOD, subtitle: "x".repeat(31) };
    const v = validateLocalizedSubmission({ copy: over, sourceName: SOURCE });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("subtitle");
  });

  it("rejects a draft whose name lost the brand token", () => {
    const v = validateLocalizedSubmission({
      copy: { ...GOOD, name: "Rezept Manager", keywords: "essensplan" },
      sourceName: SOURCE,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("Mangia");
  });

  it("rejects a smuggled description (out of v1 scope)", () => {
    const v = validateLocalizedSubmission({
      copy: { ...GOOD, description: "lange beschreibung" },
      sourceName: SOURCE,
    });
    expect(v.ok).toBe(false);
  });
});
