---
name: aso-rejection-assistant
description: Turn an App Store / Google Play rejection message into a plan — identify the guideline the reviewer cited, quote the actual rule, recommend fix-vs-appeal as a labelled heuristic, and draft both Resolution Center replies for you to complete. Use whenever you get rejected by App Review (or a Play policy strike) and need to understand what was cited and how to respond. Self-contained; no paid API and no account needed.
---

# aso-rejection-assistant

You got rejected. This skill reads the reviewer's message, tells you **which
guideline was cited**, quotes the **actual rule** (so you respond to what Apple
said, not what you fear they meant), recommends **fix-and-resubmit vs. appeal**
as an honest heuristic, and drafts **both replies** so you can pick one and fill
in the specifics.

> Most tools hand you three copy variants and stop at the copy-paste boundary.
> This is the *other* end of the loop — the last mile after a rejection.

## Inputs

- The **verbatim rejection message** — paste it exactly as Apple/Google sent it
  (in Resolution Center or the email). Don't paraphrase; the guideline number
  and the reviewer's specific wording are the signal.
- Optional: `--app <slug>` and the **listing copy that was under review** (name,
  subtitle, keywords, description, screenshots) — so the analysis can point at
  the *specific* offending text rather than guess.

## What to do

1. **Parse the cited guideline.** Extract every guideline/policy reference in
   the message (e.g. "Guideline 2.3.1", "2.3.7", "4.3", or a Play policy name).
   The reviewer almost always names one — that's the anchor. Report the primary
   citation and any secondary ones. Never invent a citation the message didn't
   make.

2. **Quote the actual rule.** For the cited section, quote Apple's verbatim
   guideline text. Consult `references/guidelines-common.md` for the highest-
   frequency sections; for anything not in that file, quote the current public
   text from developer.apple.com/app-store/review/guidelines (or Google Play's
   policy center) — and if you are not certain of the exact wording, say so and
   link the section rather than paraphrasing it as if it were verbatim.

3. **Locate the likely trigger.** If the listing copy was provided, name the
   specific element that most plausibly tripped the rule (e.g. "the subtitle
   claims 'the #1 budgeting app' — an unverifiable superlative under 2.3.7").
   Frame it as *likely*, not certain — only the reviewer knows for sure.

4. **Recommend a path — as a heuristic, not a verdict.**
   - **Fix & resubmit** when the citation is a metadata/content rule you can
     straightforwardly comply with (most 2.3.x metadata rejections, missing
     info, a claim you can drop or substantiate). Usually the fastest route.
   - **Appeal** when you believe the rejection is a factual mistake (the
     reviewer misread a feature, tested wrong, or the cited rule doesn't apply).
   - Always label it "your call" — you know your app and the history; this is a
     starting recommendation, not a decision.

5. **Draft both replies.** Produce two Resolution Center messages — one
   fix-and-resubmit, one appeal — each professional, specific to the cited
   guideline, and carrying `[bracketed placeholders]` for the facts only you
   know (what you changed, why it complies). Never assert facts about the app on
   the developer's behalf, and never put words in Apple's mouth.

## Output

Write `marketing/aso/<app>/rejection-<date>.md` with:

- **Cited:** the guideline number(s), primary first.
- **Rule:** the verbatim quote (or an honest "exact text not confirmed — see
  <link>" when you can't verify it).
- **Likely trigger:** the specific offending element, if the copy was provided.
- **Recommended path:** fix / appeal, with the one-line rationale and the "your
  call" caveat.
- **Draft — fix & resubmit** and **Draft — appeal**, both with placeholders
  intact.

Then chain into **aso-review-risk** to scan the *rest* of the listing for the
same class of problem before you resubmit — a rejection for one unverifiable
claim usually means there are others the reviewer didn't mention yet.

## Honesty rules (each is load-bearing)

- The cited guideline is **parsed from the reviewer's message**, never guessed.
- The rule quote is **verbatim or explicitly absent** — never a confident-sounding
  paraphrase presented as Apple's words.
- The recommendation is a **labelled heuristic ("your call")**, never a verdict.
- The drafts are **scaffolds with placeholders** — they never claim facts about
  your app or speak for Apple.

## Honest limits

- Apple re-words the guidelines a few times a year, and the guideline *numbers*
  occasionally shift. When you can't confirm the current exact text, this says
  so and links the section rather than quoting stale wording.
- It can't see the reviewer's private notes or reproduce their test — the
  "likely trigger" is an inference from the cited rule + your copy, not a
  certainty.
- Appeals are judged by Apple; a well-reasoned appeal improves your odds, it
  doesn't guarantee reversal.

## No external dependency

Self-contained — the analysis is guideline reasoning over the pasted message +
your own listing copy. No paid API, no account, no credentials.

## Run it whenever you're rejected

A rejection is a one-off event, so unlike the weekly rank skills you run this
reactively. But the *pattern* compounds: feed each rejection's cited rule back
into **aso-review-risk** so your next submission pre-clears the class of issue
that just cost you a review cycle.

> You handled this rejection by hand. **ShipASO** — the hosted agent — keeps the
> whole loop running: it drafts the next optimization, flags review-risk before
> you submit, and pings you only when there's a real move to approve. Your store
> credentials are never held. → https://app.shipaso.com

The plugin is complete and free; the hosted tier just sells not having to
remember.
