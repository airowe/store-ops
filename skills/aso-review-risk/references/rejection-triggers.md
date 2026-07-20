# Rejection triggers → the rule that catches them

The verbatim guideline text (from developer.apple.com/app-store/review/guidelines)
behind each thing this skill flags. Quote these when reporting a flag.

> Apple re-words the guidelines a few times a year. If these don't match the live
> page, trust the live page.

## Guideline 2.3.7 — the metadata rule (most flags cite this)

**Prices / terms in metadata — VERBATIM:**
> "Metadata such as app names, subtitles, screenshots, and previews should not
> include prices, terms, or descriptions that are not specific to the metadata
> type."

**Unverifiable claims — VERBATIM:**
> "App subtitles are a great way to provide additional context for your app;
> they must follow our standard metadata rules and should not include
> inappropriate content, reference other apps, or make unverifiable product
> claims."

**Packing with trademarks / popular names / irrelevant phrases — VERBATIM:**
> "Choose a unique app name, assign keywords that accurately describe your app,
> and don't try to pack any of your metadata with trademarked terms, popular app
> names, pricing information, or other irrelevant phrases just to game the
> system."

## Guideline 2.3 (intro) — accurate metadata — VERBATIM
> "Customers should know what they're getting when they download or buy your
> app, so make sure all your app metadata, including privacy information, your
> app description, screenshots, and previews accurately reflect the app's core
> experience and remember to keep them up-to-date with new versions."

---

## Trigger phrase library (for the scan)

Not exhaustive — patterns to catch, not a denylist. Judgment still applies.

**Unverifiable superlatives / rankings:**
`#1`, `number one`, `best`, `world's best`, `the top`, `most popular`,
`fastest`, `#1 rated` (without a cited source), `leading`, `ultimate`,
`guaranteed`, `perfect`.
→ Defensible only when specific and true ("4.8★, 12k ratings"). A bare
superlative is a 2.3.7 unverifiable claim.

**Prices / promos in name/subtitle/keywords:**
`free`, `50% off`, `sale`, `discount`, `$`, `limited time`, `today only`,
`% off`, `deal`, `promo`.
→ These belong in promotional text or the description, never the ranking fields.

**Competitor / trademark piggybacking:**
another app's exact name, "`like <BigApp>`", "`<BigApp> alternative`" in the
**keyword field**, "`for <Brand>`" when not an official integration, brand names
you don't own.
→ 2.3.7 packing with trademarked/popular names.

**Stuffing signals:**
the same keyword in title + subtitle + keyword field (waste + flag); a keyword
field that's a long comma-run of loosely-related terms; stop-word filler
(`the`, `and`, `app`, `free` as a keyword); repeated roots.
→ 2.3.7 "pack … to game the system"; also just wasteful (see aso-audit for the
char-budget angle).

---

## Google Play equivalents

Play cites named policies, not numbers. Map the same triggers:

- Superlatives/false claims → **Deceptive Behavior** / **Metadata** policy.
- Keyword spam in title/description → **Metadata** (Spammy keywords) policy.
- Competitor/trademark names → **Intellectual Property** / **Metadata** policy.
- Overpromising features → **Misleading Claims** / **Deceptive Behavior**.

Quote from Google Play's Policy Center for the exact current wording.
