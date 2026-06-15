# ShipASO — launch demo video script + shot list

A 25-second, **captions-first, muted-friendly** screen demo of the real funnel,
tuned for Show HN / Product Hunt / the GitHub README. The research bar for a
dev-tool launch: 30–90s max, show the product working in the first 10s, open
with the *problem* not the name, and make time-to-first-value visible. This one
runs tight at ~25s.

> ShipASO is a **web** product, so the hero is a **desktop/browser** recording
> (16:9), not a phone mockup. A 9:16 phone-framed cut for social is optional and
> secondary — see "Social cut" at the bottom.

---

## The one idea the video must land

**"Every ASO tool tells you what to do and abandons you. ShipASO does the work
and proves the rank moved."** — shown, not narrated. The viewer should *see*:
paste an app → a real rank appears → the agent proposes the change → the rank
moves → a shareable win. That's the whole product in one motion.

---

## Shot list (record these, in order, on `app.shipaso.com` with REAL data)

Record at 1920×1080, slow and deliberate — you can speed-ramp later. Keep the
cursor movements smooth (this is where Screen Studio-style auto-zoom would help,
but your pipeline's `hero-zoom`/`pan-up` presets cover it).

| # | Time | On screen | Caption (burned in, large, high-contrast) |
|---|------|-----------|--------------------------------------------|
| 1 | 0–3s | The empty "paste your app" field on app.shipaso.com | **Every ASO tool stops at "here's what to do."** |
| 2 | 3–5s | Type/paste a real app name, hit run | **ShipASO does the work.** |
| 3 | 5–10s | The live audit + **real organic rank** appears (the rank-check result) | **Real rank. No paid API.** |
| 4 | 10–15s | The agent's proposed copy + reasoning on the run screen | **It writes the metadata, to the exact limits.** |
| 5 | 15–19s | The approval gate → push commands / Fastlane PR reveal | **You approve. Your CI pushes. We never hold your store creds.** |
| 6 | 19–23s | The animated **"Rank movement this week"** card — #40 → #12 count-up | **Then it proves the rank moved.** |
| 7 | 23–25s | The share-a-win card / ShipASO mark + URL | **shipaso.com — the loop that ships your ASO.** |

**Cold open rule:** frame 1 must show the *problem state* (an empty field, the
promise of work) — never a logo intro. The HN crowd bounces on marketing fluff.

**Muted-first:** every beat reads from the burned-in caption alone. Voiceover is
optional polish, not required (most watch silent).

---

## Feeding it through your pipeline

> ⚠️ **Verified against the skill source:** `aso-preview-video` only supports the
> frames `iphone-16-pro` / `iphone-16` / `android` — there is **no frameless
> option**. It *always* renders a phone bezel, so it's the WRONG tool for the
> desktop/web hero shot. Use it only for the optional 9:16 social cut below.

**Hero (desktop) cut — use `video-composer` directly** with a custom composition
(browser chrome, not a phone). The composition is plain HTML+GSAP; model it on an
existing `aso-*-preview` composition but swap the device bezel for a simple
browser frame (or no frame) and set the dark ShipASO background.

```bash
# 1. Record the funnel → ~/Desktop/shipaso-funnel.mov (1920×1080)

# 2. Create the composition dir, then render. Model index.html on an existing
#    composition under marketing/skills/video-composer/compositions/, replacing
#    the phone bezel with a browser-chrome wrapper (or none), bg #0b0e14, the
#    recording in the HyperFrames-owned <video>, a hero-zoom/pan GSAP timeline,
#    and the burned-in captions below as timed .clip text layers.
#    cp -r an existing aso-*-preview composition as a starting skeleton.

bash marketing/skills/video-composer/scripts/render.sh aso-shipaso-launch

# 3. QA GATE — always run video-review before anything ships.
#    Enforce: 1920×1080, 16:9, 20–30s window, has captions, no black/letterbox.
/video-review <path-to-rendered-mp4> \
  --resolution 1920x1080 --aspect 16:9 --duration 20:30 --max-letterbox 2
```

If hand-authoring the composition is more friction than it's worth, the pragmatic
alternative is to record the funnel in **Screen Studio's free trial** (its
auto-zoom/cursor-follow gives the desktop demo polish for near-zero effort), then
still run the result through `video-review` for the QA gate. Your skills stay the
default; Screen Studio is the one targeted exception where a web product outruns
the phone-bezel pipeline.

> **Brand values to hardcode** (no ShipASO brand doc in openclaw-config yet):
> - Background: `#0b0e14`  ·  Signal green (the "rank moved" accent): `#34d399`
> - Mono numerals for ranks; the boat mark at `docs/brand/shipaso-icon.svg`
> - These match the live dashboard + the share-a-win card exactly.

---

## Captions: exact copy to burn in

Keep them short, high-contrast (white on the dark bg), bottom-third, one line each:

1. `Every ASO tool stops at "here's what to do."`
2. `ShipASO does the work.`
3. `Real organic rank. No paid API.`
4. `It writes the metadata — to the exact limits.`
5. `You approve. Your CI pushes. We never touch your store creds.`
6. `Then it proves the rank moved.`
7. `shipaso.com`

---

## Prerequisite: record with REAL data

The whole credibility play is that it's real. Before recording:
- Connect a real app you own and run the agent so there's a genuine audit + rank.
- Ideally record *after* a second run lands, so the "Rank movement" card shows a
  real #N → #M climb (otherwise it shows the on-render animation, still fine but
  less punchy). This is the same "seed your wins first" step in `GO_LIVE.md`.

---

## Social cut (optional, secondary — for X / Reels later)

A 9:16 vertical version for social, using the phone frame the skill defaults to,
focused on just beats 3 + 6 (rank appears → rank moves) — the two most
screenshot-able moments:

```bash
python3 marketing/skills/aso-preview-video/scripts/build_composition.py \
  --app shipaso --recording ~/Desktop/shipaso-funnel.mov \
  --frame iphone-16-pro --motion tilt-3d --duration 12 --aspect 9:16 \
  --bg "#0b0e14" --title "Watch the rank move" --slug social
bash marketing/skills/video-composer/scripts/render.sh aso-shipaso-social
/video-review <path> --resolution 1080x1920 --aspect 9:16 --duration 10:15 --max-letterbox 2
```

This one is `tiktok-video-batch` territory once you have multiple real wins to
dramatize — not a launch-day need.

---

## Also make a GIF (highest ROI for the README + HN)

For the GitHub README and HN, a silent **looping GIF** of beats 3+6 (paste →
rank appears → rank moves) often out-converts a video — devs evaluate in seconds.
From the same recording:

```bash
# trim the two key beats and loop as an optimized gif (<2MB for README)
ffmpeg -i ~/Desktop/shipaso-funnel.mov -ss <t_paste> -t 8 -vf \
  "fps=15,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  -loop 0 docs/brand/shipaso-demo.gif
```

Drop it at the top of the README and link it in the Show HN post.
