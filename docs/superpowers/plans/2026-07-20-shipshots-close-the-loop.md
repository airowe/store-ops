# ShipShots — Close the Loop (#153) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing ShipShots planner to the existing renderer via a pure plan→render bridge (+ CLI), and surface the planner in the product as an interactive read-only `ScreenshotPlanCard` on run detail (web + mobile).

**Architecture:** A pure Python bridge (`lib/shipshots_render.py`) maps a `ScreenshotPlan` (planner JSON) to `RenderJob`s the existing `render_locale` already draws — reusing `shot_templates.template_layout`, `build_draw_plan`, and the renderer verbatim. A thin CLI drives it. On the product side, a shared `planScreenshots` endpoint + a `ScreenshotPlan` type feed an interactive card that POSTs the run's audit inputs and displays the returned plan (never pixels; rendering stays local).

**Tech Stack:** Python 3 + Pillow (renderer, already present), TypeScript (Cloudflare Worker engine + `@shipaso/api`), React + TanStack Query + vitest (web), Expo React Native + Jest + @testing-library/react-native (mobile).

## Global Constraints

- **The LLM never paints pixels** — the planner plans; the deterministic bridge + renderer draw. Same plan in → same pixels out.
- **Measured or absent, never modeled** — a shot with no real captured screen renders a labeled placeholder (its `missingReason`), never a fabricated screen.
- **Verbatim draft label** — show `PLAN_DRAFT_LABEL` ("draft — machine-planned, review before shipping") exactly; watermark any `needsReview`/MISSING shot.
- **Nothing ships hosted** — pixel rendering + `asc screenshots upload` stay local CLI; the card is read-only.
- **Conventional Commits**, no AI-tool references in commit messages; co-author trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **TDD**: failing test → run to confirm fail → minimal impl → run to confirm pass → commit.
- Python tests run via `python3 lib/run_tests.py` (discovers `*_test.py`); web via `cloud/web` vitest; mobile via `node_modules/.bin/jest` (rtk garbles jest output — call the binary directly).
- Existing template ids are exactly `("headline-top", "headline-bottom", "full-bleed", "duo")`; an unknown id coerces to `headline-top` (mirror the TS `coerceTemplate` default).

---

## Existing code this plan consumes (do not rebuild)

- `cloud/src/engine/screenshotPlanner.ts` — emits `ScreenshotPlan`: `{ narrative, shots: PlannedShot[], label, degraded }`. `PlannedShot = { sourceScreen, missingReason?, headline, subline?, templateId, accent?, needsReview?, headlineIssue? }`. `PLAN_DRAFT_LABEL`, `TEMPLATE_IDS` exported.
- `cloud/src/api/index.ts` — `POST /plan/screenshots` (`planScreenshotsRoute`). Request body: `{ appName: string, subtitle?: string, keywords?: string[], rawScreens?: string[], audit: { grade?, recommendedCount: number, findings: string[] }, brandPalette?: string[] }`. Returns the `ScreenshotPlan`.
- `lib/shot_templates.py` — `TEMPLATE_IDS`, `template_layout(template_id: str, canvas: Canvas) -> TemplateLayout`. `TemplateLayout.slots: dict[str, SlotBox]` (may include `"headline"`, and for `duo` a `"subline"`), `TemplateLayout.device_frame: SlotBox`.
- `lib/render_localized_shots.py` — `Canvas(width, height)`, `SlotBox(x, y, width, height, align="center", color=(255,255,255))`, `DrawPlan`, `build_draw_plan(canvas, layout, manifest_locale, *, needs_review, locale="") -> DrawPlan`, `render_locale(plan, background, out_path, device_screen=None, device_frame=None) -> Path`. `render_locale` already fills a neutral device frame when `device_screen is None`, and stamps a corner watermark when `plan.needs_review`.
- `packages/api/endpoints.ts` — shared client endpoints (`c.post<T>(path, body)`); `packages/api/types.ts` — shared wire types. `RunDetail.result` carries `copy` (`name`/`subtitle`/`keywords`), `findings`, and `screenshots?: { grade, findings }`.

---

## Task 1: Python bridge — `plan_to_render_jobs`

**Files:**
- Create: `lib/shipshots_render.py`
- Test: `lib/shipshots_render_test.py`

**Interfaces:**
- Consumes (from existing code): `shot_templates.template_layout`, `shot_templates.TEMPLATE_IDS`, `render_localized_shots.Canvas`, `SlotBox`, `DrawPlan`, `build_draw_plan`.
- Produces (for Task 2 CLI):
  - `@dataclass(frozen=True) class RenderJob: draw_plan: DrawPlan; device_screen: Optional[str]; device_frame: SlotBox; out_name: str`
  - `fit_headline(text: str, box: SlotBox, base_font: int = 96, locale: str = "en") -> int` — deterministic shrink-to-fit font size (mirrors `fitCaption`).
  - `plan_to_render_jobs(plan: dict, canvas: Canvas, screen_paths: dict[str, str], *, locale: str = "en") -> list[RenderJob]`

- [ ] **Step 1: Write the failing test for `fit_headline`**

Add to `lib/shipshots_render_test.py`:

```python
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "lib"))

from render_localized_shots import Canvas, SlotBox  # noqa: E402
from shipshots_render import fit_headline, plan_to_render_jobs, RenderJob  # noqa: E402


def test_fit_headline_keeps_base_size_when_it_fits():
    box = SlotBox(x=0, y=0, width=1000, height=300)
    # a short headline at a generous box keeps the base size
    assert fit_headline("Track your rank", box, base_font=96) == 96


def test_fit_headline_shrinks_toward_floor_when_too_wide():
    box = SlotBox(x=0, y=0, width=200, height=120)
    size = fit_headline("A fairly long benefit headline here", box, base_font=96)
    assert size < 96
    # never below the 70% floor (mirrors fitCaption minSize)
    assert size >= round(96 * 0.7)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest lib/shipshots_render_test.py -q` (or `python3 lib/run_tests.py` if pytest absent)
Expected: FAIL — `ModuleNotFoundError: No module named 'shipshots_render'`.

- [ ] **Step 3: Write minimal `fit_headline` + module scaffold**

Create `lib/shipshots_render.py`:

```python
#!/usr/bin/env python3
"""
shipshots_render — the plan→render bridge for ShipShots (#153).

The planner (cloud/src/engine/screenshotPlanner.ts) emits a ScreenshotPlan; the
renderer (render_localized_shots.py) draws pixels. Nothing connected them. This
module is that bridge: it turns each PlannedShot into a RenderJob the existing
render_locale already knows how to draw — reusing the template library, the
draw-plan builder, and the renderer verbatim.

Honesty, load-bearing (mirrors the engine):
  • the LLM never paints pixels — this is pure, deterministic mapping,
  • a shot with no real captured screen (MISSING or an unknown source) renders a
    labeled placeholder (its missingReason as the caption), never a fabricated
    screen, and is forced needs_review so the watermark shows,
  • font size is a deterministic shrink-to-fit (mirrors localizeScreenshots.ts
    fitCaption), so the same plan renders identical pixels every time.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from render_localized_shots import (
    Canvas,
    DrawPlan,
    SlotBox,
    build_draw_plan,
    _avg_glyph_ratio,
    _count_wrapped_lines := None,  # placeholder; replaced below
)
```

Wait — do not import a private that may not exist. Use the concrete implementation:

```python
#!/usr/bin/env python3
"""shipshots_render — plan→render bridge for ShipShots (#153). See module docstring above."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from render_localized_shots import Canvas, DrawPlan, SlotBox, build_draw_plan, _avg_glyph_ratio
from shot_templates import TEMPLATE_IDS, template_layout

DEFAULT_LINE_HEIGHT = 1.2
_FONT_FLOOR = 0.7  # mirror fitCaption minSize default


def _wrapped_line_count(text: str, chars_per_line: int, per_char: bool) -> int:
    """How many lines `text` wraps to at `chars_per_line`. Mirrors
    localizeScreenshots.ts countWrappedLines: CJK breaks per character, everything
    else greedily by word, a word longer than the column spills to extra lines."""
    t = text.strip()
    if not t:
        return 1
    if per_char:
        return max(1, -(-len(t) // chars_per_line))  # ceil div
    lines = 1
    col = 0
    for word in t.split():
        add = len(word) if col == 0 else len(word) + 1
        if col and col + add > chars_per_line:
            lines += 1
            col = len(word)
        else:
            col += add
        if len(word) > chars_per_line:
            lines += (len(word) - 1) // chars_per_line
            col = len(word) % chars_per_line or chars_per_line
    return lines


def fit_headline(text: str, box: SlotBox, base_font: int = 96, locale: str = "en") -> int:
    """Largest whole-px size ≤ base_font at which `text` fits `box`, shrinking to a
    70% floor (mirrors fitCaption). Never returns below the floor; never truncates."""
    ratio = _avg_glyph_ratio(locale)
    per_char = ratio >= 1
    min_size = max(1, round(base_font * _FONT_FLOOR))

    def fits(size: int) -> bool:
        chars_per_line = max(1, int(box.width / (size * ratio)))
        lines = _wrapped_line_count(text, chars_per_line, per_char)
        max_lines = max(1, int(box.height / (size * DEFAULT_LINE_HEIGHT)))
        return lines <= max_lines

    if fits(base_font):
        return base_font
    for size in range(base_font - 1, min_size - 1, -1):
        if fits(size):
            return size
    return min_size
```

- [ ] **Step 4: Run test to verify `fit_headline` passes**

Run: `python3 -m pytest lib/shipshots_render_test.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for `plan_to_render_jobs`**

Add to `lib/shipshots_render_test.py`:

```python
CANVAS = Canvas(width=1290, height=2796)


def _plan(shots):
    return {"narrative": "hook then proof", "shots": shots, "label": "draft — machine-planned, review before shipping", "degraded": False}


def test_real_source_screen_becomes_a_render_job_with_that_path():
    plan = _plan([{"sourceScreen": "home", "headline": "Track your rank", "templateId": "headline-top"}])
    jobs = plan_to_render_jobs(plan, CANVAS, {"home": "/tmp/home.png"})
    assert len(jobs) == 1
    job = jobs[0]
    assert job.device_screen == "/tmp/home.png"
    assert job.draw_plan.needs_review is False
    assert job.out_name == "01-headline-top.png"
    # the headline is drawn as a caption slot
    assert any("Track your rank" in " ".join(d.lines) for d in job.draw_plan.draws)


def test_missing_shot_renders_placeholder_and_forces_review():
    plan = _plan([{"sourceScreen": "MISSING", "missingReason": "no settings screen captured", "headline": "Fine-tune it", "templateId": "duo"}])
    jobs = plan_to_render_jobs(plan, CANVAS, {})
    job = jobs[0]
    assert job.device_screen is None                    # no fabricated screen
    assert job.draw_plan.needs_review is True            # watermark will show
    drawn = " ".join(line for d in job.draw_plan.draws for line in d.lines)
    assert "no settings screen captured" in drawn        # the reason is visible on the frame


def test_unknown_source_is_demoted_to_placeholder():
    plan = _plan([{"sourceScreen": "ghost", "headline": "Nope", "templateId": "full-bleed"}])
    jobs = plan_to_render_jobs(plan, CANVAS, {"home": "/tmp/home.png"})  # "ghost" not present
    assert jobs[0].device_screen is None
    assert jobs[0].draw_plan.needs_review is True


def test_needs_review_flag_from_planner_is_carried_through():
    plan = _plan([{"sourceScreen": "home", "headline": "", "templateId": "headline-top", "needsReview": True}])
    jobs = plan_to_render_jobs(plan, CANVAS, {"home": "/tmp/home.png"})
    assert jobs[0].draw_plan.needs_review is True


def test_unknown_template_coerces_to_headline_top():
    plan = _plan([{"sourceScreen": "home", "headline": "Hi there", "templateId": "carousel"}])
    jobs = plan_to_render_jobs(plan, CANVAS, {"home": "/tmp/home.png"})
    assert jobs[0].out_name == "01-headline-top.png"


def test_out_names_are_stable_and_indexed():
    plan = _plan([
        {"sourceScreen": "home", "headline": "One", "templateId": "headline-top"},
        {"sourceScreen": "home", "headline": "Two", "templateId": "duo"},
    ])
    jobs = plan_to_render_jobs(plan, CANVAS, {"home": "/tmp/home.png"})
    assert [j.out_name for j in jobs] == ["01-headline-top.png", "02-duo.png"]
```

- [ ] **Step 6: Run to verify the new tests fail**

Run: `python3 -m pytest lib/shipshots_render_test.py -q`
Expected: FAIL — `plan_to_render_jobs` not defined / AttributeError on `RenderJob`.

- [ ] **Step 7: Implement `RenderJob` + `plan_to_render_jobs`**

Append to `lib/shipshots_render.py`:

```python
@dataclass(frozen=True)
class RenderJob:
    """One shot resolved to everything render_locale needs."""
    draw_plan: DrawPlan
    device_screen: Optional[str]   # a real capture path, or None (placeholder)
    device_frame: SlotBox
    out_name: str


def _coerce_template(template_id) -> str:
    return template_id if template_id in TEMPLATE_IDS else "headline-top"


def plan_to_render_jobs(
    plan: dict,
    canvas: Canvas,
    screen_paths: dict,
    *,
    locale: str = "en",
) -> list[RenderJob]:
    """Map a ScreenshotPlan (planner JSON) to RenderJobs the renderer draws.

    Each shot: resolve its template layout, fit the headline (+ subline when the
    template has that slot) to the caption box, resolve the source screen to a
    real path or None. A MISSING/unknown source is rendered as a labeled
    placeholder (missingReason as the caption) and forced needs_review."""
    jobs: list[RenderJob] = []
    shots = plan.get("shots") or []
    for i, shot in enumerate(shots):
        template_id = _coerce_template(shot.get("templateId"))
        layout = template_layout(template_id, canvas)

        source = shot.get("sourceScreen")
        real_path = screen_paths.get(source) if isinstance(source, str) else None
        missing = source == "MISSING" or real_path is None

        needs_review = bool(shot.get("needsReview")) or missing

        # Build the caption manifest against the template's slots.
        manifest: dict[str, dict] = {}
        headline_box = layout.slots.get("headline")
        if missing:
            # the honest gap: the reason IS the caption, so the placeholder frame
            # is self-explaining. Never a fabricated screen underneath.
            reason = shot.get("missingReason") or "no captured screen for this shot"
            if headline_box is not None:
                manifest["headline"] = {"text": reason, "fontSize": fit_headline(reason, headline_box, locale=locale)}
        else:
            headline = (shot.get("headline") or "").strip()
            if headline and headline_box is not None:
                manifest["headline"] = {"text": headline, "fontSize": fit_headline(headline, headline_box, locale=locale)}
            subline_box = layout.slots.get("subline")
            subline = (shot.get("subline") or "").strip()
            if subline and subline_box is not None:
                manifest["subline"] = {"text": subline, "fontSize": fit_headline(subline, subline_box, base_font=64, locale=locale)}

        draw_plan = build_draw_plan(canvas, layout.slots, manifest, needs_review=needs_review, locale=locale)
        jobs.append(RenderJob(
            draw_plan=draw_plan,
            device_screen=real_path if not missing else None,
            device_frame=layout.device_frame,
            out_name=f"{i + 1:02d}-{template_id}.png",
        ))
    return jobs
```

- [ ] **Step 8: Run the full bridge test file to verify it passes**

Run: `python3 -m pytest lib/shipshots_render_test.py -q`
Expected: PASS (all 8 tests).

- [ ] **Step 9: Run the whole Python suite to confirm no regressions**

Run: `python3 lib/run_tests.py`
Expected: existing suites (render_localized_shots, shot_templates, …) still pass.

- [ ] **Step 10: Commit**

```bash
git add lib/shipshots_render.py lib/shipshots_render_test.py
git commit -m "feat(shipshots): plan→render bridge — map a ScreenshotPlan to render jobs (#153)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: CLI — `render-shipshots.py`

**Files:**
- Create: `scripts/render-shipshots.py`
- Test: `lib/shipshots_render_test.py` (add a CLI-level smoke test, Pillow-guarded)

**Interfaces:**
- Consumes: `plan_to_render_jobs`, `RenderJob` (Task 1); `render_locale` (existing).
- Produces: one PNG per shot at `out/<out_name>`; a printed summary. No new importable API.

- [ ] **Step 1: Write a Pillow-guarded smoke test that a plan renders PNGs**

Add to `lib/shipshots_render_test.py`:

```python
def test_render_jobs_produce_pngs_smoke(tmp_path):
    try:
        from PIL import Image  # noqa: F401
    except Exception:
        import pytest
        pytest.skip("Pillow not installed")
    from render_localized_shots import render_locale

    plan = _plan([
        {"sourceScreen": "MISSING", "missingReason": "capture the home screen", "headline": "x", "templateId": "headline-top"},
    ])
    jobs = plan_to_render_jobs(plan, CANVAS, {})
    out = render_locale(jobs[0].draw_plan, None, tmp_path / jobs[0].out_name,
                        device_screen=jobs[0].device_screen, device_frame=jobs[0].device_frame)
    assert out.exists() and out.stat().st_size > 0
```

- [ ] **Step 2: Run to verify it passes (or skips cleanly)**

Run: `python3 -m pytest lib/shipshots_render_test.py -q`
Expected: PASS or SKIP (if Pillow absent) — never ERROR.

- [ ] **Step 3: Write the CLI**

Create `scripts/render-shipshots.py`:

```python
#!/usr/bin/env python3
"""
render-shipshots — the pixel step of ShipShots (#153). Drives the plan→render
bridge over a ScreenshotPlan (the planner's JSON output) + a directory of raw app
captures, writing one PNG per planned shot at the given App Store device size.

    POST /plan/screenshots  → plan.json          (the hosted planner; no pixels)
    render-shipshots.py     → out/<NN>-<tpl>.png  (this; local, deterministic)
    asc screenshots upload                        (downstream, your explicit step)

MISSING shots render a watermarked placeholder whose caption is the reason —
never a fabricated screen. Nothing uploads; that stays your explicit `asc` step.

Usage (from repo root):
    python3 scripts/render-shipshots.py \
        --plan    plan.json \
        --screens marketing/shots/raw/   # filename stem == sourceScreen id
        --canvas  1290x2796 \
        --out     out/
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "lib"))
from render_localized_shots import Canvas, render_locale  # noqa: E402
from shipshots_render import plan_to_render_jobs  # noqa: E402

_IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp")


def _screen_paths(screens_dir: Path) -> dict:
    """Map each capture's filename stem → its path (stem is the sourceScreen id)."""
    if not screens_dir or not screens_dir.is_dir():
        return {}
    return {
        p.stem: str(p)
        for p in sorted(screens_dir.iterdir())
        if p.suffix.lower() in _IMG_EXTS
    }


def _parse_canvas(spec: str) -> Canvas:
    w, _, h = spec.lower().partition("x")
    return Canvas(width=int(w), height=int(h))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True, help="ScreenshotPlan JSON (from POST /plan/screenshots)")
    ap.add_argument("--screens", default=None, help="dir of raw captures; filename stem == sourceScreen id")
    ap.add_argument("--canvas", default="1290x2796", help="device size WxH (default iPhone 6.7\")")
    ap.add_argument("--out", required=True, help="output dir for the PNGs")
    ap.add_argument("--locale", default="en")
    args = ap.parse_args()

    plan = json.loads(Path(args.plan).read_text())
    canvas = _parse_canvas(args.canvas)
    screen_paths = _screen_paths(Path(args.screens)) if args.screens else {}
    out_dir = Path(args.out)

    jobs = plan_to_render_jobs(plan, canvas, screen_paths, locale=args.locale)
    if plan.get("degraded"):
        print("note: this plan came from the deterministic fallback (no model shaped it).")

    review = 0
    for job in jobs:
        render_locale(job.draw_plan, None, out_dir / job.out_name,
                      device_screen=job.device_screen, device_frame=job.device_frame)
        flag = "  ⚠ needs review" if job.draw_plan.needs_review else ""
        src = job.device_screen or "MISSING (placeholder)"
        print(f"  {job.out_name}  ← {src}{flag}")
        if job.draw_plan.needs_review:
            review += 1

    print(f"\n{len(jobs)} shot(s) → {out_dir}/  ({review} need review before you ship).")
    print("Nothing was uploaded. Review, then run `asc screenshots upload` yourself.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Manually exercise the CLI end-to-end**

Run:
```bash
cat > /tmp/plan.json <<'JSON'
{"narrative":"hook","shots":[{"sourceScreen":"MISSING","missingReason":"capture home","headline":"Track your rank","templateId":"headline-top"}],"label":"draft — machine-planned, review before shipping","degraded":false}
JSON
python3 scripts/render-shipshots.py --plan /tmp/plan.json --canvas 1290x2796 --out /tmp/shots
ls -la /tmp/shots
```
Expected: prints `01-headline-top.png ← MISSING (placeholder)  ⚠ needs review`, the "Nothing was uploaded" line, and `/tmp/shots/01-headline-top.png` exists (skip this manual check if Pillow is not installed).

- [ ] **Step 5: Commit**

```bash
git add scripts/render-shipshots.py lib/shipshots_render_test.py
git commit -m "feat(shipshots): render-shipshots CLI — plan.json + screens → PNGs (#153)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Shared API — `ScreenshotPlan` type + `planScreenshots` endpoint

**Files:**
- Modify: `packages/api/types.ts`
- Modify: `packages/api/endpoints.ts`

**Interfaces:**
- Produces (for Tasks 4 & 5):
  - `type TemplateId = "headline-top" | "headline-bottom" | "full-bleed" | "duo"`
  - `type PlannedShot = { sourceScreen: string; missingReason?: string; headline: string; subline?: string; templateId: TemplateId; accent?: string; needsReview?: boolean; headlineIssue?: string }`
  - `type ScreenshotPlan = { narrative: string; shots: PlannedShot[]; label: string; degraded: boolean }`
  - `type ScreenshotPlanInputs = { appName: string; subtitle?: string; keywords?: string[]; rawScreens?: string[]; audit: { grade?: string; recommendedCount: number; findings: string[] }; brandPalette?: string[] }`
  - `planScreenshots(c: ApiClient, inputs: ScreenshotPlanInputs) => Promise<ScreenshotPlan>`

- [ ] **Step 1: Write a failing type/endpoint test**

Create `packages/api/screenshotPlan.spec.ts` (or the nearest existing endpoints spec convention — check `packages/api` for an existing `*.spec.ts`; if none, add this file and ensure it's picked up by the package's test runner):

```typescript
import { describe, expect, it } from "vitest";
import { planScreenshots } from "./endpoints.js";
import type { ApiClient } from "./client.js";
import type { ScreenshotPlan, ScreenshotPlanInputs } from "./types.js";

describe("planScreenshots", () => {
  it("POSTs the inputs to /plan/screenshots and returns the plan", async () => {
    const seen: { path: string; body: unknown }[] = [];
    const plan: ScreenshotPlan = { narrative: "n", shots: [], label: "draft — machine-planned, review before shipping", degraded: false };
    const client = {
      post: async <T,>(path: string, body?: unknown) => { seen.push({ path, body }); return plan as T; },
      get: async () => ({}),
    } as unknown as ApiClient;

    const inputs: ScreenshotPlanInputs = { appName: "Weatherly", audit: { recommendedCount: 6, findings: ["Add a 6th shot"] } };
    const out = await planScreenshots(client, inputs);

    expect(seen[0]?.path).toBe("/plan/screenshots");
    expect(seen[0]?.body).toEqual(inputs);
    expect(out).toBe(plan);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/api && npx vitest run screenshotPlan.spec.ts` (or the repo's package test command)
Expected: FAIL — `planScreenshots`/types not exported.

- [ ] **Step 3: Add the types**

In `packages/api/types.ts`, add:

```typescript
/** The fixed ShipShots template library (#153) — matches the engine's TEMPLATE_IDS. */
export type TemplateId = "headline-top" | "headline-bottom" | "full-bleed" | "duo";

/** One planned shot (mirrors the engine's PlannedShot). A MISSING sourceScreen is
 *  an honest gap — the renderer draws a labeled placeholder, never a fake screen. */
export type PlannedShot = {
  sourceScreen: string;
  missingReason?: string;
  headline: string;
  subline?: string;
  templateId: TemplateId;
  accent?: string;
  needsReview?: boolean;
  headlineIssue?: string;
};

/** The planner's output (mirrors the engine's ScreenshotPlan). `degraded` = the
 *  deterministic fallback shaped it (no model). `label` is the verbatim caveat. */
export type ScreenshotPlan = {
  narrative: string;
  shots: PlannedShot[];
  label: string;
  degraded: boolean;
};

/** Request body for POST /plan/screenshots. */
export type ScreenshotPlanInputs = {
  appName: string;
  subtitle?: string;
  keywords?: string[];
  rawScreens?: string[];
  audit: { grade?: string; recommendedCount: number; findings: string[] };
  brandPalette?: string[];
};
```

- [ ] **Step 4: Add the endpoint**

In `packages/api/endpoints.ts`, add (near the other `c.post` endpoints), importing the new types in that file's type import block:

```typescript
export const planScreenshots = (c: ApiClient, inputs: ScreenshotPlanInputs) =>
  c.post<ScreenshotPlan>("/plan/screenshots", inputs);
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd packages/api && npx vitest run screenshotPlan.spec.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck the package + dependents**

Run: `npx tsc -p packages/api --noEmit` (and the repo's top-level `check` if it typechecks web/mobile against `@shipaso/api`).
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/api/types.ts packages/api/endpoints.ts packages/api/screenshotPlan.spec.ts
git commit -m "feat(api): ScreenshotPlan type + planScreenshots endpoint (#153)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Web `ScreenshotPlanCard`

**Files:**
- Create: `cloud/web/src/features/run/ScreenshotPlanCard.tsx`
- Create: `cloud/web/src/features/run/ScreenshotPlanCard.test.tsx`
- Modify: `cloud/web/src/features/run/RunView.tsx` (compose the card)

**Interfaces:**
- Consumes: `planScreenshots`, `ScreenshotPlan`, `ScreenshotPlanInputs` from `@shipaso/api`; the web `ApiClient`; TanStack Query `useMutation`.
- Produces: `<ScreenshotPlanCard client={client} inputs={ScreenshotPlanInputs} />`.

- [ ] **Step 1: Write the failing test**

Create `cloud/web/src/features/run/ScreenshotPlanCard.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ScreenshotPlan, ScreenshotPlanInputs } from "@shipaso/api";
import { ScreenshotPlanCard } from "./ScreenshotPlanCard.js";

const inputs: ScreenshotPlanInputs = { appName: "Weatherly", audit: { grade: "C", recommendedCount: 6, findings: ["Add a 6th shot"] } };

function renderWithPlan(plan: ScreenshotPlan) {
  const client = { post: async () => plan, get: async () => ({}) } as any;
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ScreenshotPlanCard client={client} inputs={inputs} />
    </QueryClientProvider>,
  );
}

const basePlan: ScreenshotPlan = {
  narrative: "Lead with the benefit, then proof.",
  shots: [
    { sourceScreen: "home", headline: "Track your rank", templateId: "headline-top" },
    { sourceScreen: "MISSING", missingReason: "no settings screen captured", headline: "", templateId: "duo", needsReview: true },
  ],
  label: "draft — machine-planned, review before shipping",
  degraded: false,
};

describe("ScreenshotPlanCard", () => {
  it("plans on click and shows narrative + shots", async () => {
    renderWithPlan(basePlan);
    fireEvent.click(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("plan-narrative")).toHaveTextContent("Lead with the benefit"));
    expect(screen.getByText("Track your rank")).toBeInTheDocument();
  });

  it("flags a MISSING shot with its reason and a needs-review badge", async () => {
    renderWithPlan(basePlan);
    fireEvent.click(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("shot-missing-1")).toHaveTextContent("no settings screen captured"));
    expect(screen.getByTestId("shot-review-1")).toBeInTheDocument();
  });

  it("shows the verbatim draft label", async () => {
    renderWithPlan(basePlan);
    fireEvent.click(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("plan-label")).toHaveTextContent("draft — machine-planned, review before shipping"));
  });

  it("shows a degraded notice when the fallback shaped the plan", async () => {
    renderWithPlan({ ...basePlan, degraded: true });
    fireEvent.click(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("plan-degraded")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud/web && npx vitest run src/features/run/ScreenshotPlanCard.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the card**

Create `cloud/web/src/features/run/ScreenshotPlanCard.tsx`:

```tsx
/**
 * ScreenshotPlanCard (#153 ShipShots) — plan a corrected screenshot SET from the
 * run's audit findings. Interactive: clicking asks the planner (POST
 * /plan/screenshots) and renders the returned plan. It shows the PLAN, never
 * pixels — rendering is the local `render-shipshots.py` step, and nothing ships
 * from here (the standing "nothing ships hosted" posture).
 *
 * Honesty, load-bearing: a MISSING shot is shown as a labeled gap with its
 * reason (never a fabricated screen); a bad headline is a needs-review badge, not
 * silently dropped; the verbatim draft label and the `degraded` (fallback) notice
 * are always surfaced so nobody mistakes a draft/deterministic plan for a verdict.
 */
import { useMutation } from "@tanstack/react-query";
import { planScreenshots, type ApiClient, type ScreenshotPlan, type ScreenshotPlanInputs } from "@shipaso/api";

export function ScreenshotPlanCard({ client, inputs }: { client: ApiClient; inputs: ScreenshotPlanInputs }) {
  const plan = useMutation<ScreenshotPlan>({ mutationFn: () => planScreenshots(client, inputs) });
  const p = plan.data;

  return (
    <div className="card" data-testid="screenshot-plan-card">
      <b>Plan a screenshot set</b>
      <p className="micro muted" style={{ margin: "4px 0 0" }}>
        Turn this run’s screenshot findings into a shot-by-shot plan you render locally.
      </p>
      <button
        className="btn"
        data-testid="plan-screenshots-btn"
        onClick={() => plan.mutate()}
        disabled={plan.isPending}
        style={{ marginTop: 8 }}
      >
        {plan.isPending ? "Planning…" : "Plan screenshots"}
      </button>

      {p ? (
        <div style={{ marginTop: 10 }}>
          {p.degraded ? (
            <p className="micro" data-testid="plan-degraded" style={{ margin: "0 0 6px" }}>
              Deterministic fallback — no model shaped this plan.
            </p>
          ) : null}
          <p className="micro" data-testid="plan-narrative" style={{ margin: "0 0 6px" }}>{p.narrative}</p>
          <ol className="micro" data-testid="plan-shots" style={{ margin: 0, paddingLeft: 18 }}>
            {p.shots.map((s, i) => (
              <li key={i} style={{ margin: "3px 0 0" }}>
                <span className="muted">[{s.templateId}]</span>{" "}
                {s.sourceScreen === "MISSING" ? (
                  <span data-testid={`shot-missing-${i}`}>
                    <b>MISSING</b> — {s.missingReason ?? "no captured screen"}
                  </span>
                ) : (
                  <span>{s.headline || <i className="muted">(no headline)</i>} <span className="muted">← {s.sourceScreen}</span></span>
                )}
                {s.needsReview ? (
                  <span data-testid={`shot-review-${i}`} className="micro" style={{ marginLeft: 6, color: "#d97706" }}>
                    ⚠ review{s.headlineIssue ? `: ${s.headlineIssue}` : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="micro muted" data-testid="plan-label" style={{ margin: "8px 0 0" }}>{p.label}</p>
          <p className="micro muted" style={{ margin: "4px 0 0" }}>
            Render locally: <code>render-shipshots.py --plan plan.json --out out/</code>, then upload with <code>asc screenshots upload</code>.
          </p>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd cloud/web && npx vitest run src/features/run/ScreenshotPlanCard.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Compose the card in RunView (only when the run has a screenshot audit)**

In `cloud/web/src/features/run/RunView.tsx`, import it and add near the other cards, building inputs from the run result `r`:

```tsx
import { ScreenshotPlanCard } from "./ScreenshotPlanCard.js";
// … after the FindingsCard/PpoTreatmentCard block, gated on a screenshot audit:
{r.audit?.screenshots ? (
  <ScreenshotPlanCard
    client={client}
    inputs={{
      appName: r.copy?.name ?? run.name ?? "",
      subtitle: r.copy?.subtitle,
      keywords: (r.copy?.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean),
      rawScreens: [],
      audit: {
        grade: r.audit.screenshots.grade,
        recommendedCount: 6,
        findings: r.audit.screenshots.findings ?? [],
      },
      brandPalette: [],
    }}
  />
) : null}
```

Confirm the exact field names on the web `RunDetail.result` (`r.audit?.screenshots?.grade` / `.findings`, `r.copy?.name/subtitle/keywords`) against `packages/api/types.ts` before wiring; adjust the property access to match the actual type. `recommendedCount` defaults to 6 (App Store minimum-strong set) when the audit doesn't carry an explicit count.

- [ ] **Step 6: Typecheck + run the web suite**

Run: `cd cloud/web && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all web tests pass.

- [ ] **Step 7: Commit**

```bash
git add cloud/web/src/features/run/ScreenshotPlanCard.tsx cloud/web/src/features/run/ScreenshotPlanCard.test.tsx cloud/web/src/features/run/RunView.tsx
git commit -m "feat(web): ScreenshotPlanCard — plan a screenshot set from run findings (#153)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Mobile `ScreenshotPlanCard`

**Files:**
- Create: `mobile/src/components/ScreenshotPlanCard.tsx`
- Create: `mobile/src/components/ScreenshotPlanCard.test.tsx`
- Modify: `mobile/src/api/endpoints.ts` (add `planScreenshots` wrapper if mobile uses its own endpoints module)
- Modify: `mobile/app/(app)/runs/[id].tsx` (compose the card on run detail)

**Interfaces:**
- Consumes: the mobile `ApiClient`; `ScreenshotPlan`/`ScreenshotPlanInputs` from the mobile `types/api` (mirror of the shared types); mobile primitives `Card`, `AppText`, `Button`.
- Produces: `<ScreenshotPlanCard client={client} inputs={ScreenshotPlanInputs} />`.

- [ ] **Step 1: Add the mobile types + endpoint wrapper (mirror shared)**

In `mobile/src/types/api.ts`, add `TemplateId`, `PlannedShot`, `ScreenshotPlan`, `ScreenshotPlanInputs` (identical to Task 3's shapes — mobile mirrors the wire types locally, per the existing pattern where mobile has its own `types/api.ts`).

In `mobile/src/api/endpoints.ts`, add:

```typescript
export const planScreenshots = (c: ApiClient, inputs: ScreenshotPlanInputs) =>
  c.post<ScreenshotPlan>("/plan/screenshots", inputs);
```

- [ ] **Step 2: Write the failing test**

Create `mobile/src/components/ScreenshotPlanCard.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ApiClient } from "../api/client.js";
import type { ScreenshotPlan, ScreenshotPlanInputs } from "../types/api.js";
import { ScreenshotPlanCard } from "./ScreenshotPlanCard.js";

const inputs: ScreenshotPlanInputs = { appName: "Weatherly", audit: { grade: "C", recommendedCount: 6, findings: ["Add a 6th shot"] } };

function fakeClient(plan: ScreenshotPlan): ApiClient {
  return { get: async () => ({}), post: async () => plan, request: async () => ({}) } as unknown as ApiClient;
}

const basePlan: ScreenshotPlan = {
  narrative: "Lead with the benefit, then proof.",
  shots: [
    { sourceScreen: "home", headline: "Track your rank", templateId: "headline-top" },
    { sourceScreen: "MISSING", missingReason: "no settings screen captured", headline: "", templateId: "duo", needsReview: true },
  ],
  label: "draft — machine-planned, review before shipping",
  degraded: false,
};

describe("ScreenshotPlanCard (mobile)", () => {
  it("plans on press and shows the narrative + a shot headline", async () => {
    render(<ScreenshotPlanCard client={fakeClient(basePlan)} inputs={inputs} />);
    fireEvent.press(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("plan-narrative")).toBeTruthy());
    expect(screen.getByText("Track your rank")).toBeTruthy();
  });

  it("flags a MISSING shot with its reason + a needs-review badge", async () => {
    render(<ScreenshotPlanCard client={fakeClient(basePlan)} inputs={inputs} />);
    fireEvent.press(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("shot-missing-1")).toBeTruthy());
    expect(screen.getByTestId("shot-review-1")).toBeTruthy();
  });

  it("shows the verbatim draft label", async () => {
    render(<ScreenshotPlanCard client={fakeClient(basePlan)} inputs={inputs} />);
    fireEvent.press(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByText("draft — machine-planned, review before shipping")).toBeTruthy());
  });

  it("shows a degraded notice when the fallback shaped the plan", async () => {
    render(<ScreenshotPlanCard client={fakeClient({ ...basePlan, degraded: true })} inputs={inputs} />);
    fireEvent.press(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("plan-degraded")).toBeTruthy());
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd mobile && node_modules/.bin/jest src/components/ScreenshotPlanCard.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 4: Implement the mobile card**

Create `mobile/src/components/ScreenshotPlanCard.tsx`, mirroring the web card's honesty surface with mobile primitives and local `useState` (match the `RejectionAssistantCard` interaction pattern: `post` via the client on press, store result in state):

```tsx
/**
 * ScreenshotPlanCard (#153 ShipShots) — plan a corrected screenshot SET from the
 * run's audit findings. Interactive: pressing asks the planner and renders the
 * returned plan. Shows the PLAN, never pixels — rendering is the local
 * render-shipshots.py step; nothing ships from here.
 *
 * Honesty: a MISSING shot is a labeled gap with its reason (never a fabricated
 * screen); a bad headline is a needs-review badge; the verbatim draft label and
 * the degraded (fallback) notice are always shown.
 */
import { useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { planScreenshots } from "../api/endpoints.js";
import type { ScreenshotPlan, ScreenshotPlanInputs } from "../types/api.js";
import { palette, spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";

export function ScreenshotPlanCard({ client, inputs }: { client: ApiClient; inputs: ScreenshotPlanInputs }) {
  const [plan, setPlan] = useState<ScreenshotPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      setPlan(await planScreenshots(client, inputs));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <AppText kind="title">Plan a screenshot set</AppText>
      <AppText kind="micro">Turn this run’s screenshot findings into a shot-by-shot plan you render locally.</AppText>
      <Button testID="plan-screenshots-btn" title={busy ? "Planning…" : "Plan screenshots"} onPress={run} disabled={busy} />

      {plan ? (
        <View style={{ marginTop: spacing.sm }}>
          {plan.degraded ? (
            <AppText testID="plan-degraded" kind="micro">Deterministic fallback — no model shaped this plan.</AppText>
          ) : null}
          <AppText testID="plan-narrative" kind="micro">{plan.narrative}</AppText>
          {plan.shots.map((s, i) => (
            <View key={i} style={{ marginTop: spacing.xs }}>
              <AppText kind="micro">
                [{s.templateId}]{" "}
                {s.sourceScreen === "MISSING" ? "" : `${s.headline || "(no headline)"} ← ${s.sourceScreen}`}
              </AppText>
              {s.sourceScreen === "MISSING" ? (
                <AppText testID={`shot-missing-${i}`} kind="micro">
                  MISSING — {s.missingReason ?? "no captured screen"}
                </AppText>
              ) : null}
              {s.needsReview ? (
                <AppText testID={`shot-review-${i}`} kind="micro" style={{ color: palette.warn ?? "#d97706" }}>
                  ⚠ review{s.headlineIssue ? `: ${s.headlineIssue}` : ""}
                </AppText>
              ) : null}
            </View>
          ))}
          <AppText kind="micro">{plan.label}</AppText>
          <AppText kind="micro">Render locally with render-shipshots.py, then upload with asc screenshots upload.</AppText>
        </View>
      ) : null}
    </Card>
  );
}
```

Before writing, confirm the mobile primitives' real prop names (`AppText kind`, `Button title/onPress/testID/disabled`) and whether `palette.warn` exists (from `mobile/src/theme/index.ts`); adjust to the actual API. If the app store text `Track your rank` must be findable by `getByText`, ensure the headline renders as its own text node (split the `AppText` if the concatenation prevents a `getByText` match — the test asserts `getByText("Track your rank")`).

- [ ] **Step 5: Run to verify it passes**

Run: `cd mobile && node_modules/.bin/jest src/components/ScreenshotPlanCard.test.tsx`
Expected: PASS (4 tests). If `getByText("Track your rank")` fails due to concatenation, refactor the non-missing shot row so the headline is its own `<AppText>Track your rank</AppText>` node, then re-run.

- [ ] **Step 6: Compose on the run-detail screen**

In `mobile/app/(app)/runs/[id].tsx`, import and render `<ScreenshotPlanCard client={client} inputs={…} />`, building `inputs` from the run result exactly as web Task 4 Step 5 does (guarded on the run having a screenshot audit). Match the field access to the mobile `RunDetail` type in `mobile/src/types/api.ts`.

- [ ] **Step 7: Typecheck + run the mobile suite**

Run: `cd mobile && npx tsc --noEmit && node_modules/.bin/jest`
Expected: no type errors; all mobile tests pass.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/components/ScreenshotPlanCard.tsx mobile/src/components/ScreenshotPlanCard.test.tsx mobile/src/api/endpoints.ts mobile/src/types/api.ts "mobile/app/(app)/runs/[id].tsx"
git commit -m "feat(mobile): ScreenshotPlanCard — plan a screenshot set from run findings (#153)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full gates + PR

- [ ] **Step 1: Run every quality gate**

```bash
python3 lib/run_tests.py
cd packages/api && npx vitest run && npx tsc --noEmit && cd ../..
cd cloud/web && npx vitest run && npx tsc --noEmit && cd ../..
cd mobile && node_modules/.bin/jest && npx tsc --noEmit && cd ..
# repo-level check if present:
npm run check 2>/dev/null || true
```
Expected: all green.

- [ ] **Step 2: Push + open the PR**

```bash
git push -u origin feat/shipshots-close-the-loop
gh-axi pr create --title "feat: close the ShipShots loop — plan→render bridge + product card (#153)" \
  --body "Closes the last ~30% of #153. Planner, route, template library, and renderer already shipped (PR #263 + the localize renderer); the two halves didn't connect and the product couldn't trigger them.

This adds:
- \`lib/shipshots_render.py\` + \`scripts/render-shipshots.py\` — a pure plan→render bridge that maps a ScreenshotPlan onto the existing template library + renderer. MISSING shots render a watermarked placeholder with the reason as the caption — never a fabricated screen.
- \`packages/api\` \`ScreenshotPlan\` type + \`planScreenshots\` endpoint.
- \`ScreenshotPlanCard\` (web + mobile) — interactive, read-only: plans from the run's audit findings, surfaces MISSING gaps, needs-review flags, the verbatim draft label, and the degraded (fallback) notice.

Honesty invariants held: the LLM never paints pixels; measured-or-absent (no fabricated screens); verbatim draft label + watermark; nothing ships hosted (rendering + \`asc screenshots upload\` stay local).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Merge when green** (per the standing workflow: squash, sync main, delete branch — only after the user's approval per the "no merge without approval" rule).

---

## Self-Review

**Spec coverage:**
- Plan→render bridge → Task 1 (`plan_to_render_jobs`) + Task 2 (CLI). ✓
- MISSING → placeholder, never fabricated → Task 1 Step 5/7 tests + impl. ✓
- Deterministic fontSize mirroring `fitCaption` → Task 1 `fit_headline`. ✓
- `packages/api` type + endpoint → Task 3. ✓
- Read-only card, web + mobile, narrative/shots/MISSING/needs-review/label/degraded → Tasks 4 & 5. ✓
- Nothing ships hosted (card read-only; render + upload local) → card copy + Task scope. ✓
- Existing suites stay green → Task 1 Step 9, Task 6. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"write tests for the above" — every code step carries full code. Two steps say "confirm the exact field names against the actual type before wiring" — these are correctness guards for cross-package field access I could not fully pin without the live `RunDetail` shape, not placeholder implementation. Acceptable: the wiring code is shown; only the property names may need adjustment.

**Type consistency:** `ScreenshotPlan`/`PlannedShot`/`ScreenshotPlanInputs`/`TemplateId` are defined identically in Task 3 (shared) and mirrored in Task 5 (mobile). `plan_to_render_jobs`/`RenderJob`/`fit_headline` names are consistent across Tasks 1–2. `planScreenshots(c, inputs)` signature identical in Tasks 3 & 5.
