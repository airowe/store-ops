# ShipShots — close the loop (#153)

## Status of #153 before this work

The feature is ~70% built. Already shipped, tested, and on `main`:

- **LLM planner** — `cloud/src/engine/screenshotPlanner.ts` (PR #263). Produces a
  schema-validated `ScreenshotPlan`: narrative + per-shot `{sourceScreen,
  headline, subline?, templateId, accent?}`, with every guardrail (headline lint
  ≤6 words + no unmeasured claims, `MISSING` for unsourceable shots, template +
  accent whitelist, deterministic no-LLM fallback marked `degraded`).
- **API route** — `POST /plan/screenshots` in `cloud/src/api/index.ts`. Stateless;
  returns the plan, renders/ships nothing; degrades without an AI binding.
- **Template library** — `lib/shot_templates.py`. Resolves each `templateId` +
  `Canvas` → a `TemplateLayout` (caption `SlotBox`es + `device_frame`), expressed
  as canvas fractions so it scales to any device size. Tested.
- **Pixel renderer** — `lib/render_localized_shots.py`: `build_draw_plan` +
  `render_locale` composite a device screen into the template's frame and draw
  captions at an engine-chosen font size, with a DRAFT watermark on flagged shots.

## The gap this build closes

The two halves exist but **do not connect**, and the product cannot trigger them:

1. **No plan→render bridge.** Nothing turns a `ScreenshotPlan` (the planner's JSON)
   into the `{slotId: {text, fontSize}}` manifest + template layout that
   `build_draw_plan` / `render_locale` consume. `render-shots.py` only drives the
   *localize* manifest, not a planner plan.
2. **No product surface.** `/plan/screenshots` is not exposed in `packages/api`
   and there is no card in web or mobile, so a run's audit findings cannot produce
   a plan from the product.

This build delivers exactly those two pieces. It does **not** move pixel rendering
or `asc screenshots upload` into the hosted Worker — those stay in the local
plugin/CLI, matching the standing posture ("nothing ships from the hosted agent").

## Component 1 — plan→render bridge (Python)

New module `lib/shipshots_render.py` + `lib/shipshots_render_test.py`, and a thin
CLI `scripts/render-shipshots.py`.

### Core (pure, unit-tested)

```
plan_to_render_jobs(plan: dict, canvas: Canvas, screen_paths: dict[str, str])
    -> list[RenderJob]
```

`RenderJob` is a frozen dataclass carrying everything one shot's render needs:
`draw_plan: DrawPlan`, `device_screen: str | None` (a real path, or `None`),
`device_frame: SlotBox`, `out_name: str`.

Per shot in `plan["shots"]`:

- **Template** → `template_layout(shot["templateId"], canvas)` (existing). An
  unknown id is coerced to `headline-top` (mirrors the TS `coerceTemplate`
  default), never an error.
- **Captions** → a manifest `{"headline": {text, fontSize}}`, plus
  `{"subline": {...}}` when the template's layout declares a `subline` slot AND the
  shot has a subline. `fontSize` comes from a deterministic fit against the slot's
  `SlotBox`, mirroring `fitCaption` in `localizeScreenshots.ts` (same glyph ratio,
  same shrink-to-floor, never truncate). This lives in the bridge because the plan
  carries no per-slot fontSize (unlike the localize manifest).
- **Source screen** →
  - a real `sourceScreen` present in `screen_paths` → `device_screen = that path`.
  - `sourceScreen == "MISSING"`, OR a source not in `screen_paths` → `device_screen
    = None`; the renderer fills the device frame with a neutral placeholder and the
    shot is forced `needs_review = True` with the `missingReason` drawn into the
    frame. An honest gap is rendered as a labeled gap, **never** a fabricated screen.
- **needs_review** → `shot.get("needsReview")` OR the missing case above → the
  DrawPlan is watermarked (existing `render_locale` behavior).

`build_draw_plan` is reused verbatim for the caption draws. The only new drawing
concern is the placeholder-frame fill for a `None` device screen; that is a small,
smoke-tested addition to the Pillow shell in `render_localized_shots.py` (a
neutral rect + the missing reason centered), gated so the existing localized path
is unchanged when a real screen is supplied.

### CLI

```
python3 scripts/render-shipshots.py \
    --plan   path/to/plan.json \
    --screens path/to/screens/   # dir; filename stem == sourceScreen id
    --canvas 1290x2796 \
    --out    out/
# → out/01-<templateId>.png … one PNG per shot; MISSING shots render a
#   watermarked placeholder. Prints a summary incl. which shots need review.
```

## Component 2 — product surface (web + mobile)

### API client (`packages/api`)

- Add a `ScreenshotPlan` type (mirror of the engine's output: `narrative`,
  `shots[]`, `label`, `degraded`) to `packages/api/types.ts`.
- Add a client method `planScreenshots(runOrInputs)` → `POST /plan/screenshots`.

### Card (read-only) — web + mobile, TDD

`ScreenshotPlanCard` on the run-detail view (web `cloud/web/src/features/run/`,
mobile `mobile/src/components/`). It **displays the plan, not pixels** — pixels are
the local CLI step. It renders:

- the `narrative`;
- each shot: index, `templateId`, `headline` (+ `subline`), the source screen id
  or a **MISSING** flag with its reason;
- a "needs review" badge on any `needsReview` shot (bad headline / missing source);
- the verbatim `PLAN_DRAFT_LABEL` caveat once for the set;
- a `degraded` notice when the plan came from the deterministic fallback (so the
  user knows no model shaped it);
- a short "render locally" hint pointing at `render-shipshots.py` (the pixels +
  `asc screenshots upload` stay the user's explicit local step).

The card is gated to appear when the run has an audit (findings + a recommended
count) to plan against, consistent with the other run-detail cards.

## Honesty invariants (carried through)

- **The LLM never paints pixels** — planner plans; the deterministic bridge +
  renderer draw. Same plan in → same pixels out.
- **Measured or absent, never modeled** — a shot with no real screen is a labeled
  MISSING placeholder, never a fabricated screen.
- **Verbatim draft label** — `PLAN_DRAFT_LABEL` shown as-is; watermark on any
  un-reviewed / flagged shot.
- **Nothing ships hosted** — rendering + upload remain local CLI; the card is
  read-only and behind the existing run-detail approval gate.

## Testing

- `lib/shipshots_render_test.py` — `plan_to_render_jobs`: template mapping,
  MISSING/unknown-source → placeholder + needs_review, needsReview passthrough,
  deterministic fontSize fit, stable out-names. Pure; no Pillow needed.
- A smoke test that a real screen path and a `None` both produce a PNG (guarded to
  skip if Pillow is absent, like the existing renderer smoke test).
- `ScreenshotPlanCard` specs (web vitest + mobile jest/RTL): renders narrative +
  shots, MISSING flag + reason, needs-review badge, verbatim label, degraded
  notice, empty/absent plan → nothing.
- Existing planner + template + renderer suites stay green (no behavior change to
  the localized path).

## Out of scope (explicit)

- Hosted/Worker pixel rendering or Playwright in the cloud.
- Auto-upload to App Store Connect (stays the user's explicit `asc` step).
- The per-locale multiplier (#78 tie-in) — the bridge is locale-agnostic and the
  renderer already localizes; wiring N-locale plan copy is a separate follow-up.
