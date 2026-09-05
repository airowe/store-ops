---
name: aso-goldie-config
description: Turn a ShipASO run into a goldie.config.ts so App Store screenshots render on your own Mac with goldie — scenes ordered by the audit, headlines from the proposed copy, locales from the run. ShipASO supplies the diagnosis; goldie paints the strip; you approve and upload. Use when the user says "make my App Store screenshots with goldie", "generate a goldie config", "screenshot config from my audit", or "what should each screenshot say".
---

# aso-goldie-config

ShipASO knows which screens matter, what the app ranks for, and what each
screenshot should say. [goldie](https://github.com/kacperkapusciak/goldie)
(MIT) knows how to paint a screenshot strip with a device bezel, background,
and headline, on a Mac, from a `goldie.config.ts` whose headlines it cannot
originate. This skill joins the two: ShipASO emits the config, goldie renders
it, and nothing leaves your machine until you upload.

Capture runs on **your** Mac (owner decision, 2026-09-05). No binary is sent
anywhere and no simulator runs in ShipASO's infrastructure.

## What you need

- A ShipASO run for the app (any status; an approved run gives the best copy).
- A ShipASO key (`app.shipaso.com → Settings → Agent access`).
- goldie and argent installed in the app repo, per goldie's README.
- The **ids of the screens you captured or will capture** (for example
  `home`, `detail`, `settings`). A scene can only be sourced from a real
  screen; the planner marks anything else `MISSING` and the config skips it
  with the reason.

## 1) Emit the config

```bash
curl -s -X POST "https://api.shipaso.com/runs/$RUN_ID/goldie-config" \
  -H "Authorization: Bearer $SHIPASO_KEY" \
  -H "content-type: application/json" \
  -d '{"rawScreens":["home","detail","settings"],"brandPalette":["#07090e","#34d399"]}' \
  | jq -r .file > goldie.config.ts
```

`templatePreference` is optional (`"auto"`, or a ShipShots frame id). The
JSON also carries `config`, the same data as an object, if an agent would
rather read it than the file.

## 2) Fill in the two paths

The file marks them `FILL IN`: `APP_ROOT` (the app repo) and `appPath` (a
**Release** simulator build; a Debug build needs Metro and paints LogBox
banners into the captures).

## 3) Record one flow per scene

Each scene names its flow, `store-01-home`, `store-02-detail`, and so on.
Record them with argent in the app repo so each ends on the screen the scene
is about. Interesting app state (a seeded account, demo data) is yours to
produce; nothing here fabricates a screen.

## 4) Render, review, then upload yourself

```bash
goldie all
```

Review the output before anything ships:

- A scene with a `// REVIEW:` comment carries a headline the planner's lint
  flagged (an unmeasured claim, or too long). Rewrite it or drop it.
- The header says `draft — machine-planned, review before shipping`. The
  headlines are proposals from your audit, not measured facts.
- `degraded: true` in the JSON means the deterministic planner wrote the
  plan because no model was available. The order is still the audit's.

goldie writes files locally and never uploads. Upload with your own
`asc screenshots` step, or through ShipASO's approval-gated lane. A
watermarked or un-reviewed asset is refused by the upload boundary, never
merely warned about.

## What this does not do

- It does not run a simulator, capture a screen, or read your build.
- It does not invent a rating, a rating count, or an age rating for the
  store mock-up; those fields are simply absent.
- It does not push to App Store Connect. Approving is not shipping.
