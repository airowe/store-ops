#!/usr/bin/env python3
"""
Frame the raw iPad captures into marketable App Store posters (2048x2732).

Why: a raw iPad capture of the app strands its content in the top third — the
app correctly caps content to a centered ~900pt column on tablets (good UX, bad
poster). Rather than change the app layout, we frame the capture: crop it to its
real content, then composite onto a designed background with a headline caption.

Design echoes shipaso.com exactly: near-black bg (#07090e) with a signal-green
bloom + faint terminal grid, a New York serif headline with one italic
signal-green accent word (mirrors the site's "proves the rank moved" hero), a
dim SFNS subhead, and the device capture on a rounded, shadowed card.

Deterministic (Pillow), no browser. Reads RAW_DIR, writes OUT_DIR.

Usage (from repo root):
    pip install Pillow      # if not already present
    python3 scripts/frame-ipad-screenshots.py

Input : marketing/screenshots/ipad-129-2048/en-US/*.png  (2048x2732 raw captures)
Output: marketing/screenshots/ipad-129-framed/en-US/*.png (framed posters)
Fonts : macOS system New York + SFNS (see NY / NY_ITAL / SFNS below).
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

W, H = 2048, 2732

# ── brand tokens (verbatim from docs/landing/index.html) ─────────────────────
BG      = (7, 9, 14)        # --bg  #07090e
BG2     = (11, 14, 20)      # --bg-2 #0b0e14
INK     = (238, 241, 247)   # --ink #eef1f7
DIM     = (151, 161, 182)   # --dim #97a1b6
FAINT   = (98, 108, 131)    # --faint #626c83
SIGNAL  = (52, 211, 153)    # --signal #34d399
LINE_SOFT = (26, 33, 48)    # --line-soft #1a2130
PANEL   = (17, 21, 31)      # --panel #11151f

NY       = "/System/Library/Fonts/NewYork.ttf"
NY_ITAL  = "/System/Library/Fonts/NewYorkItalic.ttf"
SFNS     = "/System/Library/Fonts/SFNS.ttf"

# ── per-shot copy: honest voice, matches the site (no over-promise) ──────────
# head: list of (text, accent?) segments. accent=True → italic signal-green (the
# site hero treatment). A forced line break is expressed by splitting into rows.
# Each row is joined with spaces; punctuation is kept ATTACHED to its word so a
# dash/period never gets orphaned or dropped.
SHOTS = {
    "01-audit-result": {
        "head": [[("See your real", False)], [("ranks", True), (", free.", False)]],
        "sub": "Audit any App Store listing on live keyword data. No signup.",
    },
    "02-search-any-app": {
        "head": [[("Audit", True), (" any app,", False)], [("honestly graded.", False)]],
        "sub": "Type a name or bundle id — get a real grade back in seconds.",
    },
    "03-login-free": {
        "head": [[("Sign in only to", False)], [("ship", True), (" the fix.", False)]],
        "sub": "Your credentials stay on your machine. Nothing auto-ships.",
        # Hard-cap the crop just after the "Send magic link" button (ends ~y1036),
        # BEFORE the "(dev)" paste-a-token block (~y1140+). Debug UI must never
        # appear in a public App Store screenshot.
        "crop_max_y": 1090,
    },
}

RAW_DIR   = "marketing/screenshots/ipad-129-2048/en-US"
OUT_DIR   = "marketing/screenshots/ipad-129-framed/en-US"


def grid_bg() -> Image.Image:
    """Dark canvas + signal bloom (top-left) + faint terminal grid — the site atmosphere."""
    img = Image.new("RGB", (W, H), BG)
    # vertical panel gradient (subtle, top lighter)
    top = Image.new("RGB", (W, H), BG2)
    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)
    for y in range(H):
        md.line([(0, y), (W, y)], fill=int(46 * (1 - y / H)))  # fade to 0
    img = Image.composite(top, img, mask)

    # faint terminal grid (46px cells, like the site's 46px background-size)
    d = ImageDraw.Draw(img)
    step = 46
    for x in range(0, W, step):
        d.line([(x, 0), (x, H)], fill=LINE_SOFT, width=1)
    for y in range(0, H, step):
        d.line([(0, y), (W, y)], fill=LINE_SOFT, width=1)

    # signal-green bloom, top-left (radial, additive-ish)
    bloom = Image.new("RGB", (W, H), BG)
    bd = ImageDraw.Draw(bloom)
    cx, cy, r = int(W * 0.12), int(-H * 0.02), 1100
    for i in range(r, 0, -12):
        a = int(26 * (i / r) ** 0.6)  # falloff
        col = (min(BG[0] + a * SIGNAL[0] // 255, 255),
               min(BG[1] + a * SIGNAL[1] // 255, 255),
               min(BG[2] + a * SIGNAL[2] // 255, 255))
        bd.ellipse([cx - i, cy - i, cx + i, cy + i], fill=col)
    bloom = bloom.filter(ImageFilter.GaussianBlur(60))
    img = Image.blend(img, bloom, 0.5)
    return img


def rounded(img: Image.Image, radius: int) -> Image.Image:
    """Round the corners of the device capture."""
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0], img.size[1]], radius=radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def measure(draw, text, font):
    b = draw.textbbox((0, 0), text, font=font)
    return b[2] - b[0], b[3] - b[1]


def draw_head(base, rows, y, size=124):
    """Draw the headline as explicit rows (breaks are authored, not greedy-wrapped),
    each row centered. Segments render inline with NO inserted spaces — the copy
    embeds its own leading spaces/punctuation, so a dash or comma stays attached
    to its word. Accent segments are italic signal-green (the site hero look)."""
    reg = ImageFont.truetype(NY, size)
    ital = ImageFont.truetype(NY_ITAL, size)
    d = ImageDraw.Draw(base)
    line_h = int(size * 1.04)
    for row in rows:
        pieces = [(t, ital if a else reg, SIGNAL if a else INK, measure(d, t, ital if a else reg)[0]) for t, a in row]
        total = sum(p[3] for p in pieces)
        x = (W - total) // 2
        for t, f, col, w in pieces:
            d.text((x, y), t, font=f, fill=col)
            x += w
        y += line_h
    return y


def content_crop(img: Image.Image, pad: int = 56) -> Image.Image:
    """Trim the app's empty scroll space below the real UI. The background floor
    is ~(10,10,10) (per-channel brightness ≈30 summed); real UI rows are far
    brighter. Scan from the bottom for the last row that clears a real-content
    threshold, keep full width + top (status bar), drop the dead bottom."""
    gray = img.convert("L")
    px = gray.load()
    w, h = img.size
    THRESH = 40          # per-pixel luma; background floor sits ~10
    step = 4             # sample every 4px across the row
    # A real UI row lights up hundreds of pixels; the home-indicator / rounded
    # corner artifact at the bottom is only a handful. Require a MIN COUNT so
    # those strays don't defeat the crop.
    MIN_BRIGHT = 40
    last = h - 1
    for y in range(h - 1, -1, -1):
        if sum(1 for x in range(0, w, step) if px[x, y] > THRESH) >= MIN_BRIGHT:
            last = y
            break
    return img.crop((0, 0, w, min(h, last + pad)))


def draw_sub(base, text, y, size=52):
    f = ImageFont.truetype(SFNS, size)
    d = ImageDraw.Draw(base)
    # simple center wrap
    margin = 200
    maxw = W - 2 * margin
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if measure(d, t, f)[0] > maxw and cur:
            lines.append(cur); cur = w
        else:
            cur = t
    if cur:
        lines.append(cur)
    for ln in lines:
        tw = measure(d, ln, f)[0]
        d.text(((W - tw) // 2, y), ln, font=f, fill=DIM)
        y += int(size * 1.35)
    return y


def frame_one(name, spec):
    raw = Image.open(os.path.join(RAW_DIR, f"{name}.png")).convert("RGB")
    cap = spec.get("crop_max_y")
    if cap:                    # hard cap first (e.g. exclude dev UI), then auto-trim
        raw = raw.crop((0, 0, raw.width, min(raw.height, cap)))
    raw = content_crop(raw)    # trim the app's empty scroll space before framing
    base = grid_bg()

    # ── caption block, top ──
    y = 230
    y = draw_head(base, spec["head"], y)
    y = draw_sub(base, spec["sub"], y + 40)

    # ── device capture card, below the caption, filling the rest ──
    # scale the raw so it sits in the lower region with margins; shadow + round.
    top_of_device = y + 120
    bottom_margin = 150
    side_margin = 170
    avail_w = W - 2 * side_margin
    avail_h = H - top_of_device - bottom_margin
    scale = min(avail_w / raw.width, avail_h / raw.height)
    dw, dh = int(raw.width * scale), int(raw.height * scale)
    device = raw.resize((dw, dh), Image.LANCZOS)
    device = rounded(device, 44)

    dx = (W - dw) // 2
    dy = top_of_device + max(0, (avail_h - dh) // 2)

    # soft drop shadow
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([dx, dy + 26, dx + dw, dy + dh + 26], radius=44, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(48))
    base = Image.alpha_composite(base.convert("RGBA"), shadow)

    # hairline border ring around the device (the site's --line on cards)
    ring = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle(
        [dx - 2, dy - 2, dx + dw + 2, dy + dh + 2], radius=46, outline=(34, 42, 59, 255), width=3)
    base = Image.alpha_composite(base, ring)

    base = Image.alpha_composite(base, _place(device, dx, dy))
    out = base.convert("RGB")

    os.makedirs(OUT_DIR, exist_ok=True)
    outp = os.path.join(OUT_DIR, f"{name}.png")
    out.save(outp)
    print(f"  {outp}  {out.width}x{out.height}")


def _place(rgba, x, y):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer.paste(rgba, (x, y), rgba)
    return layer


if __name__ == "__main__":
    print("Framing iPad posters (2048x2732):")
    for name, spec in SHOTS.items():
        frame_one(name, spec)
    print("done.")
