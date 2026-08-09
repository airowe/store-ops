# Shipaton 2026 — status ledger (ShipASO)

| Item | Status | Where |
|---|---|---|
| Event brief | ✅ | `docs/shipaton/brief.md` |
| Horse + prize decided | ✅ ShipASO → #BuildInPublic | brief §strategy |
| Mandatory gate: RevenueCat SDK powers an IAP | ✅ merged | plan Workstream B/C (#426, #427, #431, #432) |
| `/health` audits RevenueCat config | ✅ merged (#434) | `cloud/src/readiness.ts` |
| Resubmit checklist (0.1.1) | ✅ merged (#435) | `marketing/aso/shipaso/resubmit-0.1.1-checklist.md` |
| #BuildInPublic engine (composer + emitter) | ✅ merged (#445) | `cloud/src/buildInPublicPost.ts` composer + `GET /apps/:id/buildinpublic-post` |
| SVG→PNG rasterization (posting edge) | ✅ | `packages/postedge/rasterize.mjs` (`@resvg/resvg-js`) |
| Posting to X | ✅ manual-paste loop (decided) | `packages/postedge/cli.mjs` — prepare → paste into X → `--mark-posted <url>` records + journals. X API auto-post skipped: no free write tier, and we're not paying for one |
| Posting to Bluesky | ✅ automated | `packages/postedge/bsky-post.mjs` (`--post-cmd`, AT Protocol, no deps) — needs the ShipASO Bluesky account + an app password (**yours**) |
| **Workstream A** — RevenueCat dashboard + store config | ⬜ **yours** — runsheet ready | `docs/shipaton/gates-runsheet.md` Gate 1: exact product ids, secrets, webhook value, /health proof |
| **Ship 0.1.1 live in-window** (the hard gate) | ⬜ **yours** — version bumped, pipeline corrected | `docs/shipaton/gates-runsheet.md` Gate 2; `mobile/app.config.ts` now 0.1.1; checklist Part 5 fixed to the real Fastlane pipeline |
| #BuildInPublic playbook (cadence + beats + evidence ledger) | ✅ | `docs/shipaton/buildinpublic-playbook.md` |
| Public /journey page on shipaso.com | ✅ built | `docs/landing/journey.html` + `docs/landing/journey/feed.json` (guard: `packages/docpaths/journeyFeed.test.mjs`); wins auto-journal via postedge `--journal` |
| Claude brain Phase 1 (reasoning + authored subtitles) | ✅ code; needs `ANTHROPIC_API_KEY` Worker secret (**yours**) | `cloud/src/api/aiReasoner.ts` (Claude > Workers AI > deterministic) + `cloud/src/engine/copyAuthor.ts`; `/health` `claude_reasoner` warn shows which brain is live |
| Build-log thread composer (weekly cadence floor) | ✅ | `packages/postedge/buildlog.mjs` |
| Screenshot + preview-footage capture in CI (agent-driven) | 🔵 scaffolded — unverified until the first macOS run; needs `ANTHROPIC_API_KEY` **Actions** secret (**yours**) then a manual dispatch | `.github/workflows/capture-shots.yml` + `marketing/screenshots/capture/PLAN.md`; raw captures feed `scripts/render-shipshots.py` |
| Marketing frame catalog (8 styles + "Let ShipASO pick") | ✅ | SoT `lib/shot_catalog.json` (⇄ `cloud/src/engine/shotCatalog.ts`, parity-spec'd); `GET /screenshot-templates`; `templatePreference` on `POST /plan/screenshots`; mobile `FramePicker` |
| Mobile capture kit v1 (recording → frames → planned set) | ✅ code — device verification at Gate 2 | `mobile/app/(app)/capture-kit.tsx`: import an iOS screen recording, pick real extracted frames, pick a frame style, plan the set, export frames; render + upload stay explicit local steps |
| Demo video ≤3 min | 🔵 script drafted | `docs/shipaton/devpost-draft.md` — recording needs a device + live 0.1.1 |
| Devpost submission + #BuildInPublic post links | 🔵 draft ready | `docs/shipaton/devpost-draft.md` + the playbook's ledger; final facts land at submission |

Legend: ✅ done · 🔵 in review · ⬜ not started. "yours" = needs a console/device only you have.
