#!/usr/bin/env python3
"""
render_localized_shots — rasterize a screenshot-localization manifest into
per-locale PNGs (#78 item 3, the "downstream renderer" PRD 04 deferred).

This is the missing pixel step in the localize-App-Store-Previews loop
(cloud/src/engine/localizeScreenshots.ts produces the plan; this draws it). The
engine already did the hard, honest part — translate each named caption slot and
DETERMINISTICALLY auto-fit a font size, flagging anything that overflows. This
renderer must therefore NOT re-decide layout: it honors the engine's font size
verbatim, only wrapping the (already-fit) caption to the slot width and drawing
it onto the user's background art.

Design, mirroring the rest of the repo (screenshotBrief / localizeScreenshots
are pure brains; rasterization is a thin shell):

    build_draw_plan(...)  →  a pure, deterministic DrawPlan (fully unit-tested):
                             where each caption line goes, at the engine's size,
                             centered/aligned, plus the draft label + a review
                             watermark when the engine flagged needsReview.
    render_locale(plan)   →  the thin Pillow shell (I/O only): composite the plan
                             onto the background and write one PNG. Smoke-tested.

HONESTY (each is a test):
  • the engine's font size is used verbatim — the renderer never reflows it,
  • a manifest slot with no box in the layout is a LOUD KeyError, never dropped,
  • when the engine flagged needsReview, the draft gets a visible review
    watermark so an un-reviewed locale can't be mistaken for a shippable asset,
  • every draft carries the verbatim machine-translated caveat.

Latin scripts (this cut's locales: es/de/fr/pt/it) render with the system font.
Non-Latin scripts need a Noto fallback (a later cut) — out of scope here.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# Verbatim from cloud/src/engine/localizeCopy.ts DRAFT_LABEL — the draft caveat
# is part of the data model, identical on both sides of the loop.
DRAFT_LABEL = "draft — machine-translated, review before shipping"

REVIEW_WATERMARK = "DRAFT · review before shipping"

# System fonts that cover Latin (es/de/fr/pt/it). Kept as a list so the draw
# shell can fall back if a path is absent on a given machine.
_LATIN_FONT_CANDIDATES = (
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)

# CJK advances ~1 em/glyph; Latin/Cyrillic ~0.52 — the SAME coarse ratio the
# engine's fitCaption uses, so wrapping here agrees with the fit it computed.
_CJK_LANGS = {"ja", "ko", "zh"}


def _avg_glyph_ratio(locale: str) -> float:
    lang = locale.lower().replace("_", "-").split("-")[0]
    return 1.0 if lang in _CJK_LANGS else 0.52


@dataclass(frozen=True)
class Canvas:
    """The output image size — one App Store device size (e.g. 1290x2796)."""
    width: int
    height: int


@dataclass(frozen=True)
class SlotBox:
    """Where a named caption sits on the canvas, in canvas pixels."""
    x: int
    y: int
    width: int
    height: int
    align: str = "center"  # "left" | "center" | "right"
    color: tuple = (255, 255, 255)


@dataclass(frozen=True)
class SlotDraw:
    """A resolved instruction to draw one caption slot."""
    slot_id: str
    lines: tuple  # the caption wrapped to the slot width (already at font_size)
    font_size: int
    box: SlotBox
    align: str
    line_height: float = 1.2


@dataclass(frozen=True)
class DrawPlan:
    """Everything render_locale needs — pure, comparable, deterministic."""
    locale: str
    canvas: Canvas
    draws: tuple
    label: str = DRAFT_LABEL
    needs_review: bool = False
    watermark: Optional[str] = None


def _wrap_to_width(text: str, font_size: int, box_width: int, locale: str) -> list[str]:
    """Wrap `text` to `box_width` px at `font_size`, using the SAME coarse glyph
    metric the engine's fitCaption used. CJK wraps per character; everything else
    greedily by word. Never truncates — wrapping only (the engine already
    guaranteed the height fits or flagged it)."""
    t = text.strip()
    if not t:
        return [""]
    ratio = _avg_glyph_ratio(locale)
    chars_per_line = max(1, int(box_width / (font_size * ratio)))

    if ratio >= 1:  # CJK — break every chars_per_line characters
        return [t[i:i + chars_per_line] for i in range(0, len(t), chars_per_line)] or [""]

    lines: list[str] = []
    col: list[str] = []
    col_len = 0
    for word in t.split():
        add = len(word) if not col else len(word) + 1
        if col and col_len + add > chars_per_line:
            lines.append(" ".join(col))
            col, col_len = [word], len(word)
        else:
            col.append(word)
            col_len += add
    if col:
        lines.append(" ".join(col))
    return lines or [""]


def build_draw_plan(
    canvas: Canvas,
    layout: dict,
    manifest_locale: dict,
    *,
    needs_review: bool,
    locale: str = "",
) -> DrawPlan:
    """Turn one locale's manifest (slotId -> {text, fontSize}) into a pure,
    deterministic DrawPlan against `layout` (slotId -> SlotBox).

    Slots are drawn in the layout's declared order (dict insertion order), so the
    plan is stable regardless of manifest key order. A manifest slot absent from
    the layout is a LOUD KeyError — an un-laid-out caption is an authoring bug,
    never silently dropped (the engine's no-silent-clipping posture, carried
    through to the pixels)."""
    for slot_id in manifest_locale:
        if slot_id not in layout:
            raise KeyError(
                f"manifest slot {slot_id!r} has no box in the layout — add it to the "
                f"layout or remove it from the source (refusing to drop it silently)"
            )

    draws: list[SlotDraw] = []
    for slot_id, box in layout.items():
        if slot_id not in manifest_locale:
            continue  # a layout box with no caption this locale — leave it empty
        entry = manifest_locale[slot_id]
        text = entry["text"]
        font_size = int(entry["fontSize"])  # verbatim from the engine's auto-fit
        lines = _wrap_to_width(text, font_size, box.width, locale)
        draws.append(SlotDraw(
            slot_id=slot_id,
            lines=tuple(lines),
            font_size=font_size,
            box=box,
            align=box.align,
        ))

    return DrawPlan(
        locale=locale,
        canvas=canvas,
        draws=tuple(draws),
        label=DRAFT_LABEL,
        needs_review=needs_review,
        watermark=REVIEW_WATERMARK if needs_review else None,
    )


# ── thin Pillow draw shell (I/O only; smoke-tested, not unit-tested) ─────────
def _load_font(size: int):
    from PIL import ImageFont
    for path in _LATIN_FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def render_locale(plan: DrawPlan, background, out_path,
                  device_screen=None, device_frame: Optional[SlotBox] = None) -> Path:
    """Composite `plan` onto `background` (a PIL image path/Image, or None for a
    neutral fill) and write one PNG at the canvas size. The engine already chose
    every font size and this plan already wrapped every line — the shell only
    draws. When plan.needs_review, stamps a corner watermark so an un-reviewed
    draft is visibly a draft.

    When `device_screen` (a raw app capture) and `device_frame` (a SlotBox, from
    a shot_templates TemplateLayout) are given, the capture is fitted into that
    rect BEFORE the captions are drawn — so the template controls exactly where
    the app screen sits and the copy always lands on top of it."""
    from PIL import Image, ImageDraw

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    W, H = plan.canvas.width, plan.canvas.height
    if background is None:
        img = Image.new("RGB", (W, H), (14, 16, 22))
    else:
        src = background if isinstance(background, Image.Image) else Image.open(background)
        img = src.convert("RGB").resize((W, H))

    # composite the app capture into the template's device frame (before captions)
    if device_screen is not None and device_frame is not None:
        dev = device_screen if isinstance(device_screen, Image.Image) else Image.open(device_screen)
        dev = dev.convert("RGB")
        # contain-fit into the frame, preserving aspect (no distortion)
        fw, fh = device_frame.width, device_frame.height
        scale = min(fw / dev.width, fh / dev.height)
        new = (max(1, round(dev.width * scale)), max(1, round(dev.height * scale)))
        dev = dev.resize(new)
        ox = device_frame.x + (fw - dev.width) // 2
        oy = device_frame.y + (fh - dev.height) // 2
        img.paste(dev, (ox, oy))

    draw = ImageDraw.Draw(img)

    for d in plan.draws:
        font = _load_font(d.font_size)
        y = d.box.y
        for line in d.lines:
            bbox = draw.textbbox((0, 0), line, font=font)
            lw = bbox[2] - bbox[0]
            if d.align == "center":
                x = d.box.x + (d.box.width - lw) // 2
            elif d.align == "right":
                x = d.box.x + (d.box.width - lw)
            else:
                x = d.box.x
            draw.text((x, y), line, font=font, fill=d.box.color)
            y += int(d.font_size * d.line_height)

    if plan.watermark:
        wm_font = _load_font(28)
        draw.text((40, H - 60), plan.watermark, font=wm_font, fill=(255, 92, 92))

    img.save(out_path, "PNG")
    return out_path
