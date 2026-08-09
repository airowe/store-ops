# ShipShots on-device render — two renderers, one contract

The framed-set renderer now exists twice: the Python pipeline
(`scripts/render-shipshots.py`, for local/CI batch work) and the on-device
Skia renderer (`mobile/src/lib/shotRender.ts` + `skiaShotRenderer.ts`, the
product surface inside the capture kit). This note is the contract that keeps
them honest together, and the decisions that would otherwise rot in commit
messages.

## The contract (shared; drift is a red test)

1. **Geometry** comes only from the frame catalog (`lib/shot_catalog.json` ⇄
   `cloud/src/engine/shotCatalog.ts`, served as `GET /screenshot-templates`).
   Both renderers resolve fraction boxes the same way: round to whole px, clamp
   to the canvas.
2. **Color rules** are identical WCAG math: accents paint the headline only
   when contrast against the KNOWN solid background ≥ 3.0 (large-text AA);
   otherwise the measured ink (white / near-black, whichever contrasts harder);
   malformed hex refused. Pinned by shared numeric vectors asserted in BOTH
   suites (e.g. contrast(#34d399, #07090e) = 10.3596 ± .001,
   contrast(#111621, #f6f7f9) = 16.8805 ± .001).
3. **Honesty rules**: a shot without a real captured frame renders a labeled
   placeholder carrying the missingReason — never a fabricated screen; a
   needs-review shot is watermarked DRAFT; captions shrink to a 70% floor and
   are never truncated.
4. **Pixel identity is NOT a goal.** Skia measures real glyphs; Python uses the
   engine's coarse metric. The two outputs may differ in line breaks — they may
   never differ in geometry, color decisions, or honesty behavior.

## Decisions

- **Tier gate**: watermark-free full-resolution export requires **Indie or
  above**, enforced on device via the entitlement (`me.tier`) with the native
  RevenueCat paywall inline — the mandatory Shipaton IAP now *sells the
  flagship feature*, not just seats. Free tier gets the full flow with
  previews (DRAFT-watermarked, downscaled) so the value is visible before the
  paywall.
- **Background**: on device the background is always a known solid — neutral
  dark by default, or any of the user's picked brand colors — so accents are
  always measurable (the Python `--bg` flag mirrors this).
- **Export**: full-res PNGs at 1290×2796 via the share sheet, named by shot
  (`01-<template>.png`). No store upload from the device — `asc screenshots
  upload` stays the explicit step; approval is the terminus.

## Not in this slice

App-preview video validation (15–30s spec) and the broadcast-extension capture
v2 are separate rows in `docs/shipaton/registry.md`.
