# ShipASO — App Review rejection, 2026-07-29

- **App:** ShipASO: Keyword Ranks (`6787632160`)
- **Version:** 0.1.0 (build 202607171830)
- **Submission:** `a64749cd-7e82-4ad1-917e-68699f8eac4d`
- **Review device:** iPad Air 11-inch (M3), iPadOS 26.5.2

## Cited

Four guidelines, primary first as the reviewer ordered them:

1. **5.2.5** — Legal · Intellectual Property
2. **3.1.1** — Business · Payments · In-App Purchase
3. **2.1(a)** — Performance · App Completeness
4. **2.3.7** — Performance · Accurate Metadata

## Rule

**2.3.7 — verbatim:**

> "Metadata such as app names, subtitles, screenshots, and previews should not
> include prices, terms, or descriptions that are not specific to the metadata
> type."

**3.1.1 — exact current text not confirmed here.** The skill's reference file
holds a summary only ("Digital goods/services must use Apple's IAP; you can't
steer users to external purchase for digital content"). The reviewer's own
message is quoted directly in the drafts below rather than paraphrasing Apple.
See https://developer.apple.com/app-store/review/guidelines/#in-app-purchase

**5.2.5 — exact text not confirmed here.** Not in the reference file. The
reviewer's specific wording was: "Terms for App Store in the app name in an
inappropriate manner." See
https://developer.apple.com/app-store/review/guidelines/#intellectual-property
and the Guidelines for Using Apple's Trademarks and Copyrights.

**2.1(a) — exact text not confirmed here.** Not in the reference file. The
reviewer reported a specific reproducible bug rather than a rule interpretation:
"The sign in link does not link user back to the app."
See https://developer.apple.com/app-store/review/guidelines/#app-completeness

## Likely trigger — verified, not inferred

Unusually for this skill, each trigger was confirmed against the live listing
rather than inferred from the cited rule.

| # | Guideline | Trigger (confirmed) |
|---|---|---|
| 1 | 5.2.5 | App name was **"ShipASO: App Store Ranks"** — read from the live app-info localization. "App Store" is Apple's mark. |
| 2 | 3.1.1 | `mobile/app/(app)/portfolio.tsx` called `billingCheckout()` then `WebBrowser.openBrowserAsync(url)` — a Stripe checkout opened in the system browser. |
| 3 | 2.1(a) | Three faults on one path: `MAGIC_LINK_BASE` unset in production, so links fell back to `api.shipaso.com` (not an associated domain); and `shipaso.com` — the host the binary declares in `applinks:` — returned **404** for `/.well-known/apple-app-site-association`. iOS had no association to read, so the link opened Safari and stayed there. |
| 4 | 2.3.7 | All three screenshots carried **"Try it — free, no signup"** / **"Try it free — no signup"**, twice as the largest text on screen. Apple counts "free" as a price reference. These were *not* caption overlays — they are the app's own UI, captured from the simulator. |

## Recommended path

**Fix & resubmit — all four.** None of these is a factual dispute with the
reviewer; each cited a real, reproducible condition, and all four are now
addressed. An appeal would be arguing against things that were true.

*Heuristic, not a verdict — your call.* An appeal draft is included below only
for completeness; it is not the recommended path here and asserting the
rejection was mistaken would be inaccurate.

## Status of each fix

| # | Guideline | Fix | Reaches Apple |
|---|---|---|---|
| 1 | 5.2.5 | Name → **"ShipASO: Keyword Ranks"** (22/30) | ✅ Already live — metadata |
| 2 | 3.1.1 | Purchase path removed entirely; app sells nothing (PR #423) | ⏳ Next build |
| 3 | 2.1(a) | Association file now served from `shipaso.com`; `MAGIC_LINK_BASE` declared in `[vars]` (PR #421) | ✅ Already live — verified 200 in production |
| 4 | 2.3.7 | "free" removed from the screens captured into screenshots (PR #422) | ⏳ Next build + re-capture |

**Two are already live.** Two are code and need a rebuild before they reach
review. The screenshots must be **re-captured from the new build** — the fix is
in source, the uploaded images are stale.

---

## Draft — fix & resubmit (recommended)

> Copy into Resolution Center. Bracketed placeholders are facts only you can
> confirm — fill them in or delete the line.

```
Thank you for the detailed review. We have addressed all four items.

Guideline 5.2.5 — Intellectual Property
The app name has been changed from "ShipASO: App Store Ranks" to
"ShipASO: Keyword Ranks", removing the Apple term from the name. We have
also reviewed the subtitle and keyword field for Apple marks.

Guideline 3.1.1 — In-App Purchase
We have removed the purchase path from the app entirely. The app no longer
offers, links to, or references the purchase of any plan. Subscriptions are
handled outside the app, and the app only reads the resulting account tier,
which we understand to be permitted under guideline 3.1.3(b). Where a feature
requires a higher tier, the app now explains which tier is needed without
offering a way to buy it.

Guideline 2.1(a) — App Completeness
Thank you for the specific report — this was a real bug and your steps
reproduced it. The sign-in link pointed at a host that was not among the app's
associated domains, and the apple-app-site-association file was not being
served from the declared domain, so iOS could not hand the link off to the app
and it opened in Safari instead. Both are fixed: the association file is now
served from the declared domain, and the sign-in link now points at that same
host. We verified the link opens the app on [device you tested on, e.g. iPad
Air 11-inch (M3)] running [iPadOS version].

Guideline 2.3.7 — Accurate Metadata
We have removed all price references from the screenshots. The wording that
mentioned a free tier has been replaced, and the screenshots have been
re-captured from the updated build. Pricing information now appears only in the
app description.

[Optional, if useful: This build also includes <anything else that changed>.]

We would appreciate another review. Please let us know if anything remains
unclear.
```

## Draft — appeal (not recommended here)

> Included for completeness. Do **not** send this unless you believe a citation
> was factually mistaken — all four were confirmed accurate against the live
> listing and the source, so an appeal would assert something untrue.

```
Thank you for the review. We would like to provide additional context on
[guideline number].

[State the specific factual point you believe was misread — e.g. what the
feature actually does, what the reviewer may have encountered, or why the
cited rule does not apply to this functionality.]

[Provide concrete evidence: reproduction steps, a demo account, a video, or the
specific screen and its behaviour.]

We are happy to make changes if we have misunderstood the guideline. Please let
us know how you would like us to proceed.
```

---

## Before resubmitting

Run **aso-review-risk** over the full listing. A rejection for one class of
problem usually means there are others the reviewer did not reach — 2.3.7 in
particular is frequently cited once and then again on the next submission for a
different field.

Specifically worth checking:

- **"App Store" still appears in the promotional text and description.** This is
  *referential* use ("audit your App Store listing"), which is ordinarily fine
  and was not cited — Apple named the **app name** only. Left as-is
  deliberately, but it is a judgement call under a guideline the reviewer
  interprets.
- The description still contains the word "free". That is permitted — Apple's
  own message says pricing information belongs in the description — but a
  reviewer who has already flagged 2.3.7 may read it less charitably.

## Remaining before resubmission

1. Reply in Resolution Center (draft above)
2. Rebuild — 2.3.7 and 3.1.1 fixes exist only in source
3. Re-capture and upload screenshots from the new build
4. Set `whatsNew` — currently **locked** by Apple while the submission sits in
   `UNRESOLVED_ISSUES`; it becomes writable once the submission is resolved
5. Resubmit
