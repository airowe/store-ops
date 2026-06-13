---
name: aso-audit
description: Audit an app's LIVE App Store / Google Play listing against ASO best practices and score every field — title, subtitle, keyword field, description, screenshots, reviews. Pulls real metadata via the asc / gplay CLIs, flags weak spots, and recommends fixes. Cross-platform (iOS + Android). Use to find ASO gaps before optimizing a listing. No paid ASO API.
---

# aso-audit

Scores a **live** store listing against ASO best practice and tells you exactly
what's weak. Reads the real listing (not guesses) via the `asc` / `gplay` CLIs.
Cross-platform — and the Google Play side is the open lane no public tool covers.

## Inputs

- `--app <slug>` (resolves the store ID via asc-id-resolver / gplay)
- `--store <appstore|playstore|both>` (default both)
- `--locale <en-US>`

## What it pulls (live, owned data — no paid API)

- **iOS**: `asc migrate export --app <APP_ID>` (reuse the `asc-metadata-sync`
  skill) → name, subtitle, keywords, promotional text, description, what's-new.
- **Android**: `gplay` metadata export (reuse `gplay-metadata-sync`) → title,
  short description, full description.
- Screenshot/preview presence + count per device.
- Recent reviews + rating (reuse `gplay-review-management` / asc reviews) for
  the keyword-gap and sentiment signal.

## What it scores (per field, 0–100 + flags)

| Field | Checks |
|---|---|
| **Title** | primary keyword present? brand+keyword balance? ≤30 (iOS) / ≤30 (Play)? |
| **Subtitle / short desc** | DISTINCT keywords from title (no waste)? value prop clear? ≤30 / ≤80? |
| **Keyword field (iOS)** | no spaces after commas (wastes chars)? no title/subtitle dupes? no filler/stop-words? plurals handled? ≤100? |
| **Description** | keyword-rich first 3 lines (the visible part)? feature clarity? Play: keyword density without stuffing? |
| **Screenshots/preview** | present for required device sizes? caption keywords? first 2 tell the story? |
| **Reviews** | rating trend, recurring complaint themes (feed back into listing + roadmap) |

## Output

Writes `marketing/aso/<app>/audit-<date>.md`:
- per-field score + specific flags ("keyword field has 3 dupes of the title;
  reclaim ~22 chars")
- a prioritized fix list
- a recommendation to run **aso-keyword-research** for any gap, then
  **aso-metadata-optimization** to generate + push the fix.

## Honest limits

- It scores what's observable from the live listing + reviews; it doesn't have
  licensed ranking data, so "you rank #X for keyword Y" is out of scope (bring a
  paid export if you want that). Everything it flags is verifiable from your own
  listing.
- Read-only: it never changes the listing. Fixes go through
  aso-metadata-optimization (which emits commands for you to approve).

## No external dependency

asc / gplay CLIs + your own listing data only. No paid ASO SaaS.
