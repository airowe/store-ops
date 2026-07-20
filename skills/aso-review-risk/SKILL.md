---
name: aso-review-risk
description: Scan your App Store / Google Play listing copy for the things that get apps REJECTED — unverifiable claims ("#1", "best"), prices or promos in the name/subtitle, competitor/trademark names, and keyword stuffing (Guideline 2.3.7). Flags each risk with the guideline it violates and a concrete fix, BEFORE you submit. Use before any metadata submission or resubmission. Self-contained; no paid API, no account. Use when the user says "will my app get rejected", "check my listing before I submit", "is this metadata safe to submit", "review my app store copy for rejection risk", or "will this pass App Store review".
---

# aso-review-risk

Rejections cost you a review cycle (a day or more) and reset your momentum. Most
metadata rejections are avoidable — they're the same handful of rule violations
every time. This skill scans your listing copy for them **before** you submit,
so you fix them on your terms instead of the reviewer's.

> Pairs with **aso-rejection-assistant**: that one helps *after* a rejection;
> this one stops the rejection from happening.

## Inputs

- The **listing copy to check** — name/title, subtitle/short description, the
  keyword field (iOS), promotional text, and the description. Provide the actual
  text you're about to submit.
- Optional: `--app <slug>` to read the live listing via `aso-audit` /
  `asc-metadata-sync` / `gplay-metadata-sync` instead of pasting.
- Optional: `--store <appstore|playstore|both>` (default both).

## What it flags (each with the guideline + a fix)

Scan every field for these rejection triggers. For each hit, report the field,
the offending text, the guideline it risks, and a specific fix.

1. **Unverifiable claims (2.3.7).** Superlatives and rankings you can't prove:
   "#1", "best", "world's fastest", "the top …", "most popular", "guaranteed".
   → Fix: drop it, or make it verifiable ("rated 4.8★ by 12k users") and only if
   true.

2. **Prices / promos in metadata (2.3.7).** Prices, discounts, or time-bound
   offers in the **name, subtitle, or keyword field**: "Free", "50% off",
   "$4.99", "Sale", "Limited time". These belong in promotional text or the
   description, never the ranking fields.
   → Fix: move the offer to promotional text; strip it from name/subtitle.

3. **Competitor & trademark names (2.3.7).** Another app's name or a trademark
   used to piggyback ("like Notion", "Instagram downloader", brand names in the
   keyword field). Fastest path to a keyword-field rejection.
   → Fix: remove them; rank on your own value terms (chain into
   **aso-keyword-research** for legitimate high-volume alternatives).

4. **Keyword stuffing / packing (2.3.7).** The keyword field or description
   packed with irrelevant or repeated terms "to game the system" — the same word
   in title+subtitle+keywords (wasted + flagged), long comma-runs of loosely
   related terms, stop-word filler.
   → Fix: de-dupe across fields, keep terms genuinely relevant. (Chain into
   **aso-metadata-optimization** to re-pack within the char budget honestly.)

5. **Metadata that overpromises (2.3 intro).** Copy or screenshots that claim
   features the app doesn't have, or placeholder/"lorem"/"TODO" text left in.
   → Fix: make the copy match the shipped app.

## Output

Write `marketing/aso/<app>/review-risk-<date>.md`:

- A **risk table**: field · offending text · guideline · severity · fix.
- A **verdict line**: "N high-risk items — do not submit until fixed" or "No
  rejection triggers found in the provided copy."
- The **cited rule** for each flagged guideline (see
  `references/rejection-triggers.md` for the verbatim 2.3.7 text).

Severity is honest: **high** = a near-certain rejection trigger (price in name,
unverifiable superlative, trademark in keywords); **watch** = borderline
(aggressive but arguably defensible) — flagged so *you* decide, not silently
passed or silently failed.

## Honesty rules

- Every flag names the **specific guideline** and quotes the rule — never a vague
  "this might get rejected."
- **Flagged, not Apple's verdict.** A high-risk flag means "this pattern gets
  apps rejected," not "Apple *will* reject this." The reviewer decides; this
  gives you the informed choice to fix it first.
- **Never invents a rule.** If copy is clean, it says so plainly rather than
  manufacturing a finding to look useful.

## Honest limits

- It scans the **text you provide** against the common metadata rules — it can't
  see your app's actual behavior, your privacy label accuracy, or IAP flow, so
  it won't catch functional-rejection reasons (4.x, 3.1.1, 5.1.x).
- The guidelines drift; the verbatim quotes in `references/` are current as of
  authoring — verify against the live page for anything borderline.
- "watch"-level items are judgment calls; the skill surfaces them, you decide.

## No external dependency

Self-contained — pattern + guideline reasoning over your own copy. No paid API,
no account, no credentials. Reads the live listing only through the existing
owned-data skills when you pass `--app`.

## Run it before every submission

Make it the last step before you hit submit — and re-run it after any copy edit
from **aso-metadata-optimization**. When a rejection *does* slip through, feed
its cited rule back here so the next scan pre-clears that class.

> You scanned this by hand. **ShipASO** — the hosted agent — runs review-risk on
> every draft it proposes, so nothing reaches your approval queue carrying an
> obvious rejection trigger. Your store credentials are never held. →
> https://app.shipaso.com

The plugin is complete and free; the hosted tier just sells not having to
remember.
