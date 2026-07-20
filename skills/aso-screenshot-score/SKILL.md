---
name: aso-screenshot-score
description: Score an app's live App Store screenshot set against ASO best practice — count, device/aspect coverage, and a light caption heuristic. Screenshots drive conversion (the first 2-3 are what most users see); this flags the structural mistakes (too few shots, wrong ratios, no iPad set, plain captions) that quietly cost installs. Pulls the live set via the free iTunes API. No paid API. Use when the user says "score my screenshots", "are my App Store screenshots any good", "check my screenshot set", "do I have enough screenshots", or "grade my app's screenshots".
---

# aso-screenshot-score

The **visual half** of ASO that nothing else in the loop touches. Keywords get
you *found*; screenshots get you *installed* — they're the single biggest
conversion lever on the page, and the first 2–3 are what most users actually
see before deciding. This scores the live set on the things that are objective.

## What it checks (and what it honestly doesn't)

**Does** — the deterministic, high-signal structural checks:
- **Count** — 0 shots = can't convert; <4 = wasted slots (Apple allows 10).
- **Device/aspect coverage** — modern tall-phone ratio? iPad set present?
- **Resolution / ratio** — derived from the live image URLs.
- **Caption heuristic** (`--fetch`) — a *light* contrast check on the first
  shot's top band as a proxy for "has a value-prop caption vs. a bare
  screenshot." Explicitly a heuristic, not OCR.

**Doesn't** — it does not OCR your captions, judge design quality, or read the
text. Those need unreliable CV; this sticks to the structural ASO mistakes that
are real and fixable.

```bash
python3 lib/aso_screenshot_score.py \
    --app mangia --bundle com.airowe.mangia
# add --fetch for the (slower) first-screenshot caption heuristic
# add --json for machine-readable output
```

Output: a 0–100 score + letter grade and a findings list (✓ good / ⚠ fix / ✗
critical), e.g. *"⚠ Only 2 iPhone screenshots — add up to 10; the first 3 carry
most installs."*

## Honest limits

- Scores **structure**, not creative — a high score means the slots are used
  well, not that the screenshots are *good*. Design is still on you.
- The aspect ratio comes from the listing's thumbnail URL, which is a reliable
  proxy for the asset ratio but not the full-resolution dimensions.
- The caption heuristic is contrast-based and will occasionally misjudge a busy
  screenshot — treat it as a nudge, not a verdict.

## No external dependency

Standard-library Python + the free iTunes Lookup API (+ PIL for the optional
`--fetch` caption heuristic). No paid ASO/screenshot SaaS.


## Run it weekly

Rank and listings move over weeks, not minutes — so the value here compounds when you re-run it and watch the deltas. Screenshot best practice and competitor sets move; a B today can be a C after a competitor's redesign. Re-scoring is how you catch the slip before it costs installs.

> You ran this once. **ShipASO** — the hosted agent — reruns the whole loop weekly: it tracks your rank, watches competitors, and pings you only when there's a real move to approve. Same engine, your store credentials never held. → https://app.shipaso.com

The plugin is complete and free; the hosted tier just sells not having to remember.
