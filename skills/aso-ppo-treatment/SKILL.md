---
name: aso-ppo-treatment
description: Design a free A/B test for your App Store screenshots — an outcome-led treatment (lead with what the user achieves, not a feature tour) plus the exact steps to run it in App Store Connect's Product Page Optimization. Use when your conversion (downloads ÷ product-page views) is flat or your first screenshot is a feature screen. A recommendation brief; you run the test in ASC. Self-contained; no paid API. Use when the user says "A/B test my screenshots", "set up a PPO test", "my downloads are flat", "improve my conversion rate", or "test a new first screenshot".
---

# aso-ppo-treatment

Keyword ranking gets you *seen*; your screenshots decide whether you get
*downloaded*. Apple gives you a **free** A/B testing tool — Product Page
Optimization (PPO) — and most developers never use it. This skill designs the
treatment worth testing and hands you the steps to run it.

> This is a **brief**, not an automated experiment. Apple runs the test; this
> tells you what to test and how to set it up. Nothing here touches your live
> listing.

## When to reach for this

- Your **measured conversion** (downloads ÷ product-page views, from App Store
  Connect → Analytics) is flat or below your category.
- Your **first screenshot** is a feature/UI screen or a bare title card rather
  than a benefit ("here's what your life looks like with this app").
- You've optimized keywords (rank is fine) but installs aren't following.

If you don't have a measured conversion baseline yet, note that and recommend
turning on Analytics first — you want a number to beat, not a guess.

## What to produce

1. **The thesis.** One line: what the current product page fails to communicate
   in the first screenshot, and the outcome to lead with instead. Outcome-led
   beats feature-led — "Never miss a bill again" outperforms "Bill tracking with
   reminders."

2. **The treatment.** A concrete, ordered screenshot set for the variant:
   - **Shot 1** — the outcome/benefit headline (the single most important frame;
     ~60% of viewers never scroll past it).
   - **Shots 2–3** — proof it delivers (the key moments, still benefit-framed,
     not a UI tour).
   - Later shots — supporting features, social proof, breadth.
   Each with the **caption** to test and *why* it should convert better than the
   current one.

3. **The setup steps** — how to run it in App Store Connect PPO:
   - App Store Connect → your app → **Product Page Optimization** → create a test.
   - Add a **treatment** (up to 3) — upload the new screenshot set (and/or icon /
     preview) for the treatment.
   - Set **traffic proportion** across treatments; pick the locales.
   - Start the test.

4. **The guidance — verbatim, so nobody reads an early result as a verdict:**
   - Let the test run toward Apple's **confidence threshold** (PPO reports when a
     treatment is a statistically significant winner) — and up to **~90 days**.
   - **Don't stop early** on a lead: small samples swing. Read it when Apple says
     it's confident, not when you're excited.
   - Change **one thing at a time** (screenshots *or* icon, not both) or you
     won't know what moved the number.

## Output

Write `marketing/aso/<app>/ppo-treatment-<date>.md`:

- **Thesis** (one line).
- **Treatment** — the ordered shot list with captions + the per-shot rationale.
- **Setup steps** for ASC PPO.
- **Guidance** — the run-length + confidence caveat, verbatim.
- **Evidence framing** — public PPO case studies have measured large conversion
  swings from outcome-led first screenshots; cite it as *public precedent*, and
  never as a prediction about this specific app's numbers.

Chain into **asc-shots-pipeline** (iOS) or **gplay-screenshot-automation**
(Android) to actually render the treatment screenshots, and **aso-screenshot-score**
to sanity-check the set before you upload it.

## Honesty rules

- It's a **recommendation you run yourself** in App Store Connect — not an
  automated test, and nothing here writes to your listing.
- **No fabricated conversion predictions.** The evidence is *public PPO results
  have shown outcome-led screenshots convert better* — cited precedent, never a
  claim about your app's expected lift.
- The run-length / confidence **guidance is verbatim** so an early, noisy result
  never reads as a verdict.

## Honest limits

- **iOS only** for the test tool — PPO is Apple's. Google Play has its own
  store-listing experiments (Play Console → Store presence → Store listing
  experiments); the treatment thinking transfers, the setup steps don't.
- It designs the *treatment*; it can't run the test, read Apple's Analytics, or
  measure the outcome for you — you start the test and read the result in ASC.
- Screenshot design is judgment; this gives you a strong, testable hypothesis,
  not a guaranteed winner. That's what the A/B test is *for*.

## No external dependency

Self-contained — creative strategy + the public PPO workflow. No paid API, no
account, no credentials.

## Run it when conversion is the bottleneck

Rank and conversion are different levers — when ranking is healthy but installs
lag, this is the lever. Re-run it each time you have a new outcome hypothesis or
a fresh conversion baseline to beat.

> You designed this treatment by hand. **ShipASO** — the hosted agent — proposes
> the outcome-led PPO treatment automatically on a keyed run and tracks the
> measured conversion after you ship it, so you see whether the number actually
> moved. Your store credentials are never held. → https://app.shipaso.com

The plugin is complete and free; the hosted tier just sells not having to
remember.
