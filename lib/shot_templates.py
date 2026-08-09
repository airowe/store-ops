#!/usr/bin/env python3
"""
shot_templates — the marketing frame library for ShipShots (#153), resolved
from the shared catalog at lib/shot_catalog.json.

The planner (cloud/src/engine/screenshotPlanner.ts) emits, per shot, one of the
catalog's `templateId`s. This module is the deterministic other half: it
resolves a templateId + a Canvas into a `TemplateLayout` — the caption
`SlotBox`es that build_draw_plan draws into, plus a `device_frame` rect telling
render_locale where to composite the app screen.

The catalog JSON is the single source of truth for the frame geometry AND the
picker-facing marketing metadata (name / why-it-converts). The TypeScript
mirror `cloud/src/engine/shotCatalog.ts` carries the same data for the planner,
the API catalog endpoint, and the product pickers; a parity spec on that side
diffs it against this JSON so the two can never drift.

"Typography/spacing/frames are code, so the set is internally consistent and
deterministic" (#153). Layouts are expressed as fractions of the canvas, so
every template scales to any App Store device size (iPhone 1290×2796, iPad
2048×2732, …) without hardcoded pixels. Same template + canvas → same boxes.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from render_localized_shots import Canvas, SlotBox

_CATALOG_PATH = Path(__file__).resolve().parent / "shot_catalog.json"
CATALOG = json.loads(_CATALOG_PATH.read_text())

# Catalog order is the library order (the deterministic planner cycles it).
TEMPLATE_IDS = tuple(t["id"] for t in CATALOG["templates"])

_TEMPLATES = {t["id"]: t for t in CATALOG["templates"]}


@dataclass(frozen=True)
class TemplateLayout:
    """A resolved template: caption slots + where the device screen goes."""
    slots: dict          # slot_id -> SlotBox (feeds build_draw_plan)
    device_frame: SlotBox  # where render_locale composites the app capture


def _box(canvas: Canvas, *, fx: float, fy: float, fw: float, fh: float, align: str = "center") -> SlotBox:
    """A SlotBox from canvas fractions, rounded to whole pixels and clamped so it
    never spills off the canvas (keeps every template on-canvas at any size)."""
    x = round(fx * canvas.width)
    y = round(fy * canvas.height)
    w = round(fw * canvas.width)
    h = round(fh * canvas.height)
    w = min(w, canvas.width - x)
    h = min(h, canvas.height - y)
    return SlotBox(x=x, y=y, width=w, height=h, align=align)


def template_layout(template_id: str, canvas: Canvas) -> TemplateLayout:
    """Resolve a catalog templateId + Canvas into a TemplateLayout. Unknown ids
    raise ValueError — the renderer must never guess a layout for a template it
    doesn't have (the engine already whitelists templateId, so this is the
    belt-and-suspenders guard)."""
    spec = _TEMPLATES.get(template_id)
    if spec is None:
        raise ValueError(
            f"unknown templateId {template_id!r} — must be one of {TEMPLATE_IDS}"
        )
    slots = {
        slot_id: _box(canvas, fx=b["fx"], fy=b["fy"], fw=b["fw"], fh=b["fh"],
                      align=b.get("align", "center"))
        for slot_id, b in spec["slots"].items()
    }
    d = spec["deviceFrame"]
    device = _box(canvas, fx=d["fx"], fy=d["fy"], fw=d["fw"], fh=d["fh"])
    return TemplateLayout(slots=slots, device_frame=device)
