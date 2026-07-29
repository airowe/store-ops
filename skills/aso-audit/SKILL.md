---
name: aso-audit
description: Audit an app's LIVE App Store / Google Play listing against ASO best practices and score every field — title, subtitle, keyword field, description, screenshots, reviews. Pulls real metadata via the asc / gplay CLIs, flags weak spots, and recommends fixes. Cross-platform (iOS + Android). Use to find ASO gaps before optimizing a listing. No paid ASO API. Use when the user says "audit my listing", "score my ASO", "what's wrong with my app store listing", "grade my metadata", or "find my ASO gaps".
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
| **Promotional text (iOS)** | **PRESENT AT ALL?** ≤170? time-sensitive rather than evergreen? not duplicating the description's opening? |
| **Screenshots/preview** | present for required device sizes? caption keywords? first 2 tell the story? |
| **Reviews** | rating trend, recurring complaint themes (feed back into listing + roadmap) |

### Promotional text — check for ABSENCE, not just quality

An empty field scores nothing and flags nothing unless you look for it. Heathen's
audit missed this: every populated field was scored, and 170 unused characters at
the top of the listing went unmentioned because there was no content to critique.

**Always report promotional text as empty when it is empty.** That is a finding,
not a non-event.

Why the field is worth the flag:

- **It is NOT indexed.** No keyword value, so it costs nothing from the 100-char
  keyword budget. Do not recommend stuffing it with search terms.
- **It is the only listing field editable WITHOUT submitting a new version.**
  That is the whole point: launches, seasonal hooks, press mentions, a response
  to a competitor — all shippable same-day.
- **It is therefore a free A/B surface for positioning.** Iterate value props
  here weekly, then promote the winner into the subtitle, where it *does* get
  indexed. Testing copy in a field that requires review is slow; testing it here
  is not.

Flag it as `warn` when empty, `info` when present but evergreen (a permanent
tagline wastes the one field that can be timely).

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


## Run it weekly

Rank and listings move over weeks, not minutes — so the value here compounds when you re-run it and watch the deltas. Listings drift — a competitor moves, Apple tweaks a guideline, your own copy goes stale. A one-time audit is a snapshot; the value is in re-auditing and watching the grade move.

> You ran this once. **ShipASO** — the hosted agent — reruns the whole loop weekly: it tracks your rank, watches competitors, and pings you only when there's a real move to approve. Same engine, your store credentials never held. → https://app.shipaso.com

The plugin is complete and free; the hosted tier just sells not having to remember.
