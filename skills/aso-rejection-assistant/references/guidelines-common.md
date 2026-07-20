# Common App Review Guideline citations (rejection reference)

The sections App Review cites most often, for fast lookup. **VERBATIM** entries
are copied word-for-word from Apple's public guidelines
(developer.apple.com/app-store/review/guidelines). **SUMMARY** entries paraphrase
the rule — when you cite one of these, verify the current exact wording before
quoting it as Apple's words.

> Apple re-words the guidelines a few times a year and occasionally renumbers
> them. If a citation here doesn't match what the reviewer wrote, trust the
> reviewer's message and check the live guidelines page.

---

## 2.3 — Accurate Metadata (the most common rejection family)

### 2.3 (intro) — metadata must reflect the real app — VERBATIM
> "Customers should know what they're getting when they download or buy your
> app, so make sure all your app metadata, including privacy information, your
> app description, screenshots, and previews accurately reflect the app's core
> experience and remember to keep them up-to-date with new versions."

Typical trigger: screenshots show features that aren't in the build; description
promises something the app doesn't do; placeholder/lorem text left in metadata.
→ Usually **fix & resubmit** (make the metadata match the app, or ship the
feature).

### 2.3.7 — names, subtitles, keywords: no prices, no unverifiable claims, no packing — VERBATIM
> "Metadata such as app names, subtitles, screenshots, and previews should not
> include prices, terms, or descriptions that are not specific to the metadata
> type."

> "App subtitles are a great way to provide additional context for your app;
> they must follow our standard metadata rules and should not include
> inappropriate content, reference other apps, or make unverifiable product
> claims."

> "Choose a unique app name, assign keywords that accurately describe your app,
> and don't try to pack any of your metadata with trademarked terms, popular app
> names, pricing information, or other irrelevant phrases just to game the
> system."

Typical trigger: "#1", "best", "world's fastest" (unverifiable superlatives);
"50% off" or "Free" in the name/subtitle (price in metadata); competitor or
trademarked names stuffed in the keyword field. → Almost always **fix &
resubmit**: drop or substantiate the claim, remove pricing from metadata,
de-pack the keyword field. (Chain into **aso-review-risk** to catch the rest.)

### 2.3.1 — no hidden or undocumented features — SUMMARY
Apps must not include hidden, dormant, or undocumented features; what you submit
is what's reviewed. Typical trigger: a feature gated behind a flag, or
functionality the reviewer couldn't reach. → **Fix & resubmit** (document/enable
it) unless the reviewer misunderstood how to reach it → then **appeal** with
repro steps.

### 2.3.3 — screenshots show the app in use — SUMMARY
Screenshots should show the app in actual use, not just a title/splash/login
screen. → **Fix & resubmit** with real in-app screenshots.

---

## 4.3 — Spam / duplicate — SUMMARY
Rejects apps that duplicate an existing app or a saturated category with no
added value (common for template/reskinned apps). This is a hard one to fix by
metadata alone — it's usually about the app's substance. → If you genuinely add
value the reviewer missed, **appeal** with the specifics; otherwise it needs a
product change, not a copy change.

## 5.1.1 — privacy: data collection & consent — SUMMARY
Privacy policy required; data collection must be disclosed and consented; the
privacy "nutrition label" must match actual behavior. → **Fix & resubmit**
(align the label + policy with what the app does).

## 3.1.1 — in-app purchase — SUMMARY
Digital goods/services must use Apple's IAP; you can't steer users to external
purchase for digital content. → **Fix & resubmit** (route through IAP) — appeals
rarely succeed here.

---

## Google Play (policy strikes, not numbered guidelines)

Play cites **named policies** rather than section numbers. The common ones:

- **Metadata policy** — no misleading text/graphics, no unverified claims, no
  keyword spam in the title/description, no "#1"/"best" without substantiation.
- **Deceptive Behavior** — the listing must not misrepresent function.
- **Repetitive Content / Spam** — near-duplicate listings.
- **User Data / Data safety** — the Data safety form must match real behavior.

Play's Policy Center links the exact policy in the strike email — quote from
there, and treat the strike's own text as the anchor.

---

## How to use this file

1. Match the reviewer's cited section to the entry above.
2. If it's **VERBATIM**, quote it directly.
3. If it's **SUMMARY** (or absent here), verify the current exact wording on the
   live guidelines/policy page before quoting — otherwise cite the section and
   link it rather than presenting a paraphrase as Apple's words.
