/**
 * Creative-asset brief (PRD 05 / #436, Phase A) — the ASO reasoning half of
 * Apple's new creative assets, built BEFORE the API exists.
 *
 * Apple announced product-page headers and search-results creative assets on
 * 2026-08-05, "coming this fall". What shipped that day was design guidance and
 * templates — no endpoints, no resource names, and **no published dimensions**.
 *
 * So this describes CONTENT, never a spec. Every plan carries
 * `specsKnown: false` and no output string may contain a pixel size, aspect
 * ratio or duration: inventing one would be a fabricated measurement dressed as
 * guidance, and a user would build to it. When Apple publishes the real specs,
 * `specsKnown` becomes the seam that turns this from a sketch into a brief.
 *
 * The two surfaces have genuinely different jobs, and conflating them is the
 * mistake this module exists to prevent:
 *
 *   • searchResult — the first thing a searcher sees, so it inherits shot 1's
 *     job from PRD 02: lead with the top winnable keyword.
 *   • productPageHeader — brand, season, what's new. The thing screenshots
 *     cannot do ("go beyond in-use visuals"). Keyword-stuffing it would be
 *     cargo-culting the search asset's job onto a surface nobody searches.
 *
 * Honesty, per the conversion lane: a search-results asset changes whether
 * someone CHOOSES you from the results — it does not move your rank. No copy
 * here may imply otherwise.
 */
import type { Opportunity } from "./rankOpportunity.js";

export type CreativeSurface = "productPageHeader" | "searchResult";

export type CreativeAssetPlan = {
  surface: CreativeSurface;
  /** headers accept image or video; say which and why. */
  medium: "image" | "video";
  /** what this asset must communicate. */
  focus: string;
  /** the opportunity it reinforces, when one is measured. */
  keyword?: string;
  /** the ASO logic — why this, on this surface. */
  rationale: string;
  /** false until Apple publishes dimensions. Never describe a size while false. */
  specsKnown: boolean;
};

export type CreativeAssetBriefInput = {
  opportunities?: Opportunity[];
  appName: string;
  subtitle?: string;
  /** rival names, used only to say "differentiate from X" — never to copy them. */
  competitors?: string[];
  /** the fixed brand palette; a header must draw from it rather than free-form. */
  brandPalette?: string[];
};

export type CreativeAssetBrief = {
  assets: CreativeAssetPlan[];
  /** honesty frame, including that specs are unpublished. */
  note: string;
};

/**
 * The strongest MEASURED opportunity, or null.
 *
 * `scored: false` is excluded deliberately. An unscored opportunity's score is
 * the 42.5 artifact of absent data (#65) — leading the search asset with it
 * would present a default as a finding. Legacy rows carry `undefined`, which
 * the type treats as scored, so only an explicit `false` is filtered.
 */
function topScored(opportunities: readonly Opportunity[] | undefined): Opportunity | null {
  const scored = (opportunities ?? []).filter((o) => o.scored !== false);
  if (scored.length === 0) return null;
  return scored.reduce((best, o) => (o.opportunityScore > best.opportunityScore ? o : best));
}

/**
 * The note is the honesty frame. It has to carry three things at once: that
 * this is a starting point rather than a guarantee, that the surfaces are a
 * conversion lever and not a ranking one, and that Apple has not published the
 * specs — so nothing here is a size to build against.
 */
const NOTE =
  "A starting point, not a guarantee: this describes what each asset should say, " +
  "based on your measured keywords. Creative assets change whether someone chooses " +
  "you from the results — they do not move your position in them. Apple has not " +
  "yet published dimensions or formats for these surfaces, so this brief covers " +
  "content only; no size here is a specification.";

export function creativeAssetBrief(input: CreativeAssetBriefInput): CreativeAssetBrief {
  const top = topScored(input.opportunities);
  const rival = input.competitors?.[0];
  const accent = input.brandPalette?.[0];

  // Search results: the first thing a searcher sees, so it inherits shot 1's
  // job — lead with the term they actually typed. With nothing measured we say
  // so rather than inventing a keyword to lead with.
  const searchFocus = top
    ? `Make “${top.keyword}” unmistakable at a glance — the term someone typed to get here.`
    : `Lead with what ${input.appName} is, in the words someone would search for.`;

  const searchRationale = top
    ? `“${top.keyword}” is your strongest measured opportunity (${top.why}). ` +
      `This asset sits where searchers compare you side by side, so it decides who they tap — ` +
      `not where you appear.` +
      (rival ? ` Say what ${rival} does not.` : "")
    : `No keyword is measured well enough to lead with yet, so this stays on the plainest ` +
      `statement of what the app does.` + (rival ? ` Whatever it says, it should not read like ${rival}.` : "");

  // The header does what screenshots cannot: brand, season, what's new. Giving
  // it a keyword would cargo-cult the search asset's job onto a surface nobody
  // searches, so `keyword` is deliberately absent here.
  const headerFocus =
    `Brand and season — the mood ${input.appName} leaves someone with` +
    (input.subtitle ? `, in the spirit of “${input.subtitle}”` : "") +
    (accent ? `. Build it from your palette, starting with ${accent}.` : ".");

  const headerRationale =
    `Someone reaching your page has already chosen to look, so this is not the place to ` +
    `re-argue the search term. Headers are for what in-use screenshots cannot show — ` +
    `brand, a season, what is new.` +
    (accent ? ` Drawing from ${accent} keeps it recognisably yours rather than free-form.` : "");

  return {
    assets: [
      {
        surface: "searchResult",
        medium: "image",
        focus: searchFocus,
        ...(top ? { keyword: top.keyword } : {}),
        rationale: searchRationale,
        specsKnown: false,
      },
      {
        surface: "productPageHeader",
        // Apple says headers accept either. Image is the honest default: it is
        // the one every app can produce, and recommending video would imply a
        // duration we have no published limit for.
        medium: "image",
        focus: headerFocus,
        rationale: headerRationale,
        specsKnown: false,
      },
    ],
    note: NOTE,
  };
}
