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
| **Workstream A** — RevenueCat dashboard + store config | ⬜ **yours** | Paid Apps Agreement, products, keys/secrets |
| **Ship 0.1.1 live in-window** (the hard gate) | ⬜ **yours** | build 0.1.1 → sandbox test → submit → live |
| #BuildInPublic playbook (cadence + beats + evidence ledger) | ✅ | `docs/shipaton/buildinpublic-playbook.md` |
| Public /journey page on shipaso.com | ✅ built | `docs/landing/journey.html` + `docs/landing/journey/feed.json` (guard: `packages/docpaths/journeyFeed.test.mjs`); wins auto-journal via postedge `--journal` |
| Build-log thread composer (weekly cadence floor) | ✅ | `packages/postedge/buildlog.mjs` |
| Demo video ≤3 min | 🔵 script drafted | `docs/shipaton/devpost-draft.md` — recording needs a device + live 0.1.1 |
| Devpost submission + #BuildInPublic post links | 🔵 draft ready | `docs/shipaton/devpost-draft.md` + the playbook's ledger; final facts land at submission |

Legend: ✅ done · 🔵 in review · ⬜ not started. "yours" = needs a console/device only you have.
