#!/usr/bin/env python3
"""
audit_card_render — rasterize an audit card (analytics-reports PRD 05, #437)
into a 1600x900 PNG, the shape a post on X shows whole.

The MODEL is `cloud/src/engine/auditCard.ts`: `GET /report/:appId` returns it
as `card`. This is the image half, mirroring render_localized_shots.py:

    build_card_plan(card)  →  a pure, deterministic CardPlan (unit-tested):
                              every text run and rect, in canvas pixels.
    render_card(plan, out) →  the thin Pillow shell (I/O only).

HONESTY (each is a test):
  • a value is drawn ONLY from state "measured"; "pending" draws "—" plus
    Apple's window, "unavailable" draws "—" plus the reason, "absent" draws
    "—" alone. There is no other branch, and no digit is ever invented,
  • the finding is the headline — a card with no headline text is an error,
    never a silently emptier card,
  • the four state names are pinned to the TypeScript union by
    cloud/src/engine/auditCardParity.spec.ts, which reads this file.

Usage:
    curl -s https://api.shipaso.com/report/<appId> | python3 lib/audit_card_render.py - out.png
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

W, H = 1600, 900
DASH = "—"

# The four CardValue states. Keep this tuple in sync with the TypeScript union
# in cloud/src/engine/auditCard.ts — the parity spec reads it from here.
CARD_STATES = ("measured", "pending", "unavailable", "absent")

BG = (7, 9, 14)
PANEL = (17, 21, 31)
LINE = (34, 42, 59)
INK = (238, 241, 247)
DIM = (151, 161, 182)
FAINT = (98, 108, 131)
SIGNAL = (52, 211, 153)

FONT_PATHS = (
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


@dataclass(frozen=True)
class TextRun:
    x: int
    y: int
    text: str
    size: int
    color: tuple[int, int, int]
    bold: bool = False


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    w: int
    h: int
    fill: tuple[int, int, int] | None
    outline: tuple[int, int, int] | None = None


@dataclass
class CardPlan:
    width: int = W
    height: int = H
    rects: list[Rect] = field(default_factory=list)
    texts: list[TextRun] = field(default_factory=list)


def show_value(v: dict[str, Any], fmt) -> tuple[str, str]:
    """A CardValue → (value text, note text). The only place a state is read."""
    state = v.get("state")
    if state == "measured":
        return fmt(v["value"]), ""
    if state == "pending":
        return DASH, str(v.get("reason", ""))
    if state == "unavailable":
        return DASH, str(v.get("reason", ""))
    if state == "absent":
        return DASH, ""
    raise ValueError(f"unknown CardValue state: {state!r}")


def _num(n: Any) -> str:
    return f"{int(n):,}" if float(n).is_integer() else f"{n}"


def _rating(r: dict[str, Any]) -> str:
    # Plain text on purpose: the system fonts we fall back to carry no star glyph.
    return f"{float(r['avg']):.1f} · {int(r['count']):,} ratings"


def _truncate(s: str, limit: int) -> str:
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def build_card_plan(card: dict[str, Any]) -> CardPlan:
    """Pure layout. Raises on a card with no headline — the finding IS the card."""
    headline = str(card.get("aso", {}).get("headline", "")).strip()
    if not headline:
        raise ValueError("audit card has no headline; refusing to render inventory alone")

    plan = CardPlan()
    plan.rects.append(Rect(0, 0, W, H, BG))
    plan.rects.append(Rect(0, 0, W, 8, SIGNAL))

    ident = card["identity"]
    dev_text, _ = show_value(ident["developer"], str)
    plan.texts.append(TextRun(120, 96, _truncate(str(ident["name"]), 40), 44, INK, bold=True))
    plan.texts.append(TextRun(120, 152, dev_text, 26, DIM))

    chips = []
    for key in ("category", "price"):
        text, _ = show_value(card["chips"][key], str)
        if text != DASH:
            chips.append(text)
    rel, _ = show_value(ident["released"], lambda s: f"Since {str(s)[:10]}")
    if rel != DASH:
        chips.append(rel)
    x = 120
    for chip in chips:
        w = 22 * len(chip) // 2 + 36
        plan.rects.append(Rect(x, 196, w, 40, None, LINE))
        plan.texts.append(TextRun(x + 18, 205, chip, 20, DIM))
        x += w + 10

    plan.texts.append(TextRun(120, 286, _truncate(headline, 78), 38, INK, bold=True))
    rank = card["aso"]["rankSummary"]
    src = rank.get("source", "ShipASO rank check") if rank.get("state") == "measured" else "ShipASO rank check"
    plan.texts.append(TextRun(120, 340, str(src), 20, FAINT))

    hero_y = 400
    for i, (label, key) in enumerate((("DOWNLOADS", "downloads"), ("PROCEEDS", "proceeds"))):
        hx = 120 + i * 690
        value, note = show_value(card["hero"][key], _num)
        plan.rects.append(Rect(hx, hero_y, 670, 150, PANEL, LINE))
        plan.texts.append(TextRun(hx + 24, hero_y + 20, label, 18, DIM))
        plan.texts.append(TextRun(hx + 24, hero_y + 50, value, 52, INK if value != DASH else FAINT, bold=True))
        if note:
            plan.texts.append(TextRun(hx + 24, hero_y + 116, _truncate(note, 72), 18, FAINT))

    tiles_y = 580
    score_v = card["aso"]["score"]
    grade = card["aso"].get("grade")
    score_text, _ = show_value(score_v, lambda n: f"{int(n)}/100" + (f" · {grade}" if grade else ""))
    rating_text, _ = show_value(card["tiles"]["rating"], _rating)
    size_text, _ = show_value(card["tiles"]["size"], str)
    for i, (label, text) in enumerate((("LISTING SCORE", score_text), ("RATING", rating_text), ("SIZE", size_text))):
        tx = 120 + i * 460
        plan.rects.append(Rect(tx, tiles_y, 440, 96, PANEL, LINE))
        plan.texts.append(TextRun(tx + 20, tiles_y + 16, label, 16, DIM))
        plan.texts.append(TextRun(tx + 20, tiles_y + 44, text, 30, INK if text != DASH else FAINT, bold=True))

    fy = 712
    for f in card["aso"].get("topFindings", [])[:2]:
        plan.texts.append(TextRun(120, fy, _truncate(str(f.get("title", "")), 60), 24, INK, bold=True))
        plan.texts.append(TextRun(120, fy + 32, _truncate(str(f.get("fix", "")), 110), 20, DIM))
        fy += 72

    stamp = f"Measured {str(card.get('measuredAt', ''))[:10]} · {card.get('country', '')} · every number measured or {DASH}"
    plan.texts.append(TextRun(120, 856, stamp, 18, FAINT))
    plan.texts.append(TextRun(1180, 856, "shipaso.com", 18, SIGNAL))
    return plan


def _font(size: int, bold: bool):
    from PIL import ImageFont

    for path in FONT_PATHS:
        try:
            return ImageFont.truetype(path, size, index=1 if (bold and path.endswith(".ttc")) else 0)
        except (OSError, ValueError):
            continue
    return ImageFont.load_default()


def render_card(plan: CardPlan, out_path: str | Path) -> Path:
    """The thin Pillow shell: draw the plan, write one PNG."""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (plan.width, plan.height), BG)
    draw = ImageDraw.Draw(img)
    for r in plan.rects:
        draw.rectangle((r.x, r.y, r.x + r.w, r.y + r.h), fill=r.fill, outline=r.outline, width=1 if r.outline else 0)
    for t in plan.texts:
        draw.text((t.x, t.y), t.text, fill=t.color, font=_font(t.size, t.bold))
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG")
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    src, out = argv[1], argv[2]
    raw = sys.stdin.read() if src == "-" else Path(src).read_text()
    data = json.loads(raw)
    card = data.get("card", data)
    render_card(build_card_plan(card), out)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
