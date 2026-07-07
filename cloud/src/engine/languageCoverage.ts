/**
 * Language coverage — storefront-intel PRD 03
 * (`docs/prd/storefront-intel/03-languages-coverage.md`).
 *
 * The public storefront page lists an app's LANGUAGES (display names, e.g.
 * "English", "German") — measured data the lookup API never returns. This
 * turns that list into localization coverage + expansion recommendations for
 * KEYLESS runs, which today get no localization signal at all (recommendLocales
 * needs the ASC locale list). ASC-sourced coverage always wins on keyed runs;
 * this never overrides it.
 *
 * The granularity trap: `languages[]` is language-level, ASC locales are
 * locale-level. "English" can't tell us whether en-GB metadata exists, so we
 * (a) label coverage `source: "storefront"` and (b) exclude EVERY locale of a
 * listed language — rather miss a real opportunity than call a surface
 * unclaimed when we never measured it.
 *
 * Pure. No bindings, no fetch.
 */
import localesData from "./locales-data.json";
import { rankAll, type LocaleRecommendation } from "./localizationExpansion.js";

export type LanguageCoverage = {
  /** Storefront (language-level) coverage — ASC coverage never uses this type. */
  source: "storefront";
  /** Measured, verbatim from the page's Languages shelf. */
  languages: string[];
  /** Model locales whose `language` display-name is listed (conservative). */
  coveredLocales: string[];
  /** Listed names the bundled model doesn't know — surfaced, never guessed. */
  unmappedLanguages: string[];
};

type LocaleEntry = { language: string };
type LocalesModel = { locales: Record<string, LocaleEntry> };
const MODEL = localesData as unknown as LocalesModel;

/** language display-name → the model's locale codes for it (e.g. English → en-*). */
function localesByLanguage(): Map<string, string[]> {
  const byLang = new Map<string, string[]>();
  for (const [code, entry] of Object.entries(MODEL.locales)) {
    const list = byLang.get(entry.language) ?? [];
    list.push(code);
    byLang.set(entry.language, list);
  }
  return byLang;
}

/**
 * Map listed language names to covered locale codes (conservative: all codes of
 * a listed language), splitting out names the model doesn't recognize.
 */
export function coverageFromLanguages(languages: string[]): LanguageCoverage {
  const byLang = localesByLanguage();
  const coveredLocales: string[] = [];
  const unmappedLanguages: string[] = [];
  for (const name of languages) {
    const codes = byLang.get(name);
    if (codes) coveredLocales.push(...codes);
    else unmappedLanguages.push(name);
  }
  return {
    source: "storefront",
    languages,
    coveredLocales: [...new Set(coveredLocales)].sort(),
    unmappedLanguages,
  };
}

/** Saturation cap by LANGUAGE count (mirrors maxForLiveCount, but language-level). */
function maxForLanguageCount(count: number): number {
  if (count <= 1) return 7;
  if (count === 2) return 6;
  if (count === 3) return 5;
  if (count === 4) return 4;
  return 3;
}

/**
 * Expansion recommendations from the storefront language list. Reuses rankAll's
 * scoring + ordering (excluding covered locales), but corrects the two fields
 * rankAll derives from `liveLocales.length` — effort and count — to be
 * LANGUAGE-count-driven. Feeding N expanded English codes into rankAll would
 * falsely read as N live locales and taper a single-language app to "new".
 */
export function recommendLocalesFromLanguages(input: {
  languages: string[];
  category?: string | undefined;
}): { recommendations: LocaleRecommendation[]; coverage: LanguageCoverage } {
  const coverage = coverageFromLanguages(input.languages);
  if (input.languages.length === 0) {
    return { recommendations: [], coverage };
  }

  const languageCount = input.languages.length;
  const effort: LocaleRecommendation["effort"] = languageCount <= 1 ? "translate" : "new";

  // rankAll excludes coveredLocales and gives ROI-ordered candidates; we then
  // stamp the language-count-derived effort onto each rec (rankAll baked in the
  // wrong one from the expanded live-locale count).
  const ranked = rankAll({
    liveLocales: coverage.coveredLocales,
    category: input.category,
  }).map((rec) => (rec.effort === effort ? rec : { ...rec, effort }));

  const cap = maxForLanguageCount(languageCount);
  const take = languageCount <= 1 ? Math.max(5, cap) : cap;
  return { recommendations: ranked.slice(0, Math.min(take, cap, ranked.length)), coverage };
}
