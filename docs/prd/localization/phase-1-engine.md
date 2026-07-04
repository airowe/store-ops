# Phase 1 — engine + API: per-locale draft generation

Depends on: nothing (first phase). Ships alone: drafts are returned to the
client and can be applied by hand; no persistence, no writes.

## Engine: `src/engine/localizeCopy.ts`

```ts
/** Provider-agnostic translation seam — Workers AI now, DeepL-ready. */
export type Localizer = (req: {
  text: string;
  targetLocale: string;   // BCP-47 as ASC uses it, e.g. "de-DE", "ja"
  kind: "name" | "subtitle" | "keyword" | "promo";
}) => Promise<string>;    // raw translated text; throws on provider failure

export type LocalizeInput = {
  copy: CopyFields;        // the APPROVED en-US copy (post-edit, not the agent draft)
  targetLocale: string;
  /** the brand token(s) that must survive verbatim, e.g. ["Mangia"] —
   *  derived from the live name's leading segment, overridable. */
  brandTokens: string[];
};

export type LocalizedDraft = {
  locale: string;
  copy: CopyFields;        // fitted to limits, validated
  validation: CopyValidation;
  /** true when any field was trimmed to fit — surfaced in the UI. */
  trimmed: string[];
  /** honest label the UI must render verbatim. */
  label: "draft — machine-translated, review before shipping";
};

export async function localizeCopy(
  localizer: Localizer,
  input: LocalizeInput,
): Promise<LocalizedDraft>
```

Rules (each is a test):

- **Brand tokens survive verbatim.** Implementation: placeholder-swap before
  translation (`Mangia` → `⟦0⟧`), restore after; a post-check asserts every
  token present or the draft is rejected (throw, honest failure — never a
  translated brand).
- **Keyword field translates term-by-term** (split on commas, translate each
  `kind:"keyword"`, re-pack via `buildKeywordField` against the *translated*
  name/subtitle — Apple's no-repeat rule applies per locale). Terms that
  translate to something already in the translated title/subtitle are dropped
  by `buildKeywordField` exactly as en-US.
- **Limits enforced**: each field through `fitToLimit`; fields that needed a
  trim are listed in `trimmed` (the UI shows "trimmed to fit 30").
- **Description untouched** (out of scope v1 — the field is simply absent
  from the draft; the UI never renders an empty description as "translated").
- **Deterministic degrade is refusal**: any provider error → the whole call
  throws. No partial drafts, no silent en-US fallbacks presented as
  translations.

## Workers AI adapter: `src/api/aiLocalizer.ts`

`localizerForEnv(env.AI): Localizer | null` — mirrors `reasonerForEnv`.
Prompt per field kind (marketing register for name/subtitle, bare term for
keywords), temperature low, output stripped of quotes/explanations. `null`
when the binding is absent → the route 503s with the honest "translation
needs the AI binding" message.

## API: `POST /runs/:id/localize`

- Auth: owner of the run's app. Run must be `approved`/`shipped` (we localize
  what the human approved, never the unapproved draft).
- Body: `{ locale: string }` — must be one of the ASC locale codes we already
  ship in `locales-data.json`; loud 400 otherwise.
- Source copy: the run's **final** copy (post-`finalizeEditedCopy`), same
  precedence as the fastlane bundle.
- Response: the `LocalizedDraft`, verbatim. Stateless in this phase — nothing
  stored, nothing written.
- Rate concern: one reasoner call per field per request (≤4). No batching
  needed at our volume.

## Tests

- Guardrails: brand-token survival (incl. multi-token), term-by-term keyword
  packing against translated surfaces, trim listing, provider-failure refusal.
- Adapter: prompt shape per kind; absent binding → null.
- Route: 403 unapproved, 400 unknown locale, 503 no binding, happy path
  returns validated draft with the honest label.
