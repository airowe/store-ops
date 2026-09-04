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
| **Workstream A** — RevenueCat dashboard + store config | ✅ **done** — verified 2026-09-04 | Group `ShipASO Tiers` (22297926) + 3 products all `READY_TO_SUBMIT`; 4 × `REVENUECAT_*` secrets set; `GET /health` → `ready: true`, both `revenuecat_*` ok. Webhook proven live in prod: unauthed `POST /billing/revenuecat` → **401, not 503** |
| **Ship 0.1.1 live in-window** (the hard gate) | 🔴 **REJECTED TWICE** — 2.1(a), cause found + fixed, needs rebuild + resubmit | See "Review history" below. Fix = a review token in the ASC notes (`review-notes-0.1.1.md`); verified signing in on an iPad sim 2026-09-04 |
| #BuildInPublic playbook (cadence + beats + evidence ledger) | ✅ | `docs/shipaton/buildinpublic-playbook.md` |
| Public /journey page on shipaso.com | ✅ built | `docs/landing/journey.html` + `docs/landing/journey/feed.json` (guard: `packages/docpaths/journeyFeed.test.mjs`); wins auto-journal via postedge `--journal` |
| Claude brain Phase 1 (reasoning + authored subtitles) | ✅ code; needs `ANTHROPIC_API_KEY` Worker secret (**yours**) | `cloud/src/api/aiReasoner.ts` (Claude > Workers AI > deterministic) + `cloud/src/engine/copyAuthor.ts`; `/health` `claude_reasoner` warn shows which brain is live |
| Build-log thread composer (weekly cadence floor) | ✅ | `packages/postedge/buildlog.mjs` |
| Screenshot + preview-footage capture in CI (agent-driven) | 🔵 scaffolded — unverified until the first macOS run; needs `ANTHROPIC_API_KEY` **Actions** secret (**yours**) then a manual dispatch | `.github/workflows/capture-shots.yml` + `marketing/screenshots/capture/PLAN.md`; raw captures feed `scripts/render-shipshots.py` |
| Marketing frame catalog (8 styles + "Let ShipASO pick") | ✅ | SoT `lib/shot_catalog.json` (⇄ `cloud/src/engine/shotCatalog.ts`, parity-spec'd); `GET /screenshot-templates`; `templatePreference` on `POST /plan/screenshots`; mobile `FramePicker` |
| Brand colors (picker → palette → contrast-guarded pixels) | ✅ | mobile `ColorPicker` → `brandPalette`; renderer paints a shot's accent only when it measures readable against the solid background (`--bg`), else the measured ink — an unreadable color never ships |
| **On-device render + tier-gated export (the sellable loop)** | ✅ code — device verification at Gate 2 | `mobile/src/lib/shotRender.ts` (pure twin of the Python bridge; parity vectors pinned in both suites) + `skiaShotRenderer.ts` + `RenderSetCard`; full-res 1290×2796 on the phone, previews on every tier, export requires Indie via the native paywall. Contract: `docs/shipaton/shipshots-device-render.md` |
| App-preview video validation (15–30s spec) | ⬜ not started | raw footage exists (CI `recordVideo` + kit recordings); no trimmer/spec-checker yet |
| Phone capture v2 (broadcast extension + deep-link + Live Activity) | ⬜ not started | UX compression of the kit's manual-record flow; only if time allows |
| Mobile capture kit v1 (recording → frames → planned set) | ✅ code — device verification at Gate 2 | `mobile/app/(app)/capture-kit.tsx`: import an iOS screen recording, pick real extracted frames, pick a frame style, plan the set, export frames; render + upload stay explicit local steps |
| Demo video ≤3 min | 🔵 script drafted | `docs/shipaton/devpost-draft.md` — recording needs a device + live 0.1.1 |
| Devpost submission + #BuildInPublic post links | 🔵 draft ready | `docs/shipaton/devpost-draft.md` + the playbook's ledger; final facts land at submission |

Legend: ✅ done · 🔵 in review · 🔴 blocked/failed · ⬜ not started. "yours" = needs a
console/device only you have.

---

## Review history — 0.1.1 has never passed

Read this before touching the submission. Both rejections were **the same
failure**, and both times the mechanism to prevent it already existed in the
code while the review notes told the reviewer to do something impossible.

| Submitted | Submission | Outcome | Guideline | What the reviewer hit |
|---|---|---|---|---|
| 2026-07-17 | `d12f518b` | withdrawn | — | items `REMOVED` |
| 2026-07-18 | `a64749cd` | withdrawn | — | items `REMOVED` |
| 2026-08-20 | `8d82affb` | **rejected 08-24** | 2.1(a) | "the 'Connect' button was not responsive after sign in" — iPad Air 11-inch (M3), iPadOS 26.6, build `202608192254` |

**Root cause (diagnosed 2026-09-04).** Sign-in is passwordless. The notes told
the reviewer to tap "Send magic link" and open the emailed link — but that link
goes to `adaminsley+shipaso-review@gmail.com`, a mailbox App Review cannot open,
and the notes stated a token was *deliberately* omitted because magic tokens
expire in 15 minutes. The reviewer had no way in and reported the login screen's
controls as unresponsive. They never reached the dashboard, so the "Connect"
they named is a login-screen control, not the Connect picker.

`POST /auth/review-exchange` + the "Have a sign-in token?" card were built after
the 2026-08-14 rejection for exactly this, minting a 90-day token that survives
review (`mobile/app/(public)/login.tsx:97-108` records the same lesson). The
mechanism shipped; the notes never carried the token.

**Verified 2026-09-04, not assumed:**

- Minted review token → `POST /auth/review-exchange` on **production** → HTTP 200,
  kind `review`, correct account, expires 2026-12-03.
- Signed in on an **iPad Pro 13 simulator** via that token: dashboard rendered,
  "Connect an app" search + button laid out correctly in the centered column.
  **The Connect picker is not broken on iPad** — that risk is closed.
- `SESSION_SECRET` was rotated 2026-09-04. Any token minted before that is dead.

### Before the next submission

1. Replace `<REVIEW_TOKEN>` in `review-notes-0.1.1.md` with a freshly minted
   token, **in App Store Connect only** — it is a bearer credential and must not
   be committed.
2. Build with the real key: `cd mobile && set -a && . ../.env && set +a &&
   fastlane ios beta`. A placeholder or empty key logs `Invalid API Key` and
   leaves the paywall dead — the same 3.1.1 failure that rejected 0.1.0.
   (Observed on the 2026-09-04 sim build, which used a placeholder
   deliberately.) The `build` lane now **aborts before `expo prebuild`** unless
   `REVENUECAT_IOS_KEY` is set and starts with `appl_`; previously four docs
   asked for the key and nothing enforced it, so a forgotten export uploaded a
   dead paywall with every step reporting success.
3. Prove the sandbox purchase round-trip on a device: buy → webhook → tier
   applied. **Still unproven.** App Review has never seen the paywall — both
   rejections happened at sign-in, and in `8d82affb` the three subscription items
   were still `READY_FOR_REVIEW`, never evaluated.

### The submission container is EMPTY (found 2026-09-04)

A draft review submission exists and reads `READY_FOR_REVIEW` — which means
*the container may be submitted*, *not* that anything is in it:

| Submission | State | Items |
|---|---|---|
| `741b079c-de60-4e3d-880b-fd0aa9668e78` | `READY_FOR_REVIEW` | **0** |

Submitting it as-is sends Apple nothing to review. This is very likely the same
reason the three subscriptions were never evaluated in the rejected `8d82affb`.

**Item IDs are NOT product IDs.** `asc review items add --item-type
subscriptionVersions` takes a subscription *version* ID; the numeric IDs from
`asc subscriptions list` are product IDs and are a different resource (the CLI
says so itself: "Version IDs are distinct from subscription product IDs").
Resolved 2026-09-04 via `asc subscriptions versions list --subscription-id`:

| Item | Type | ID |
|---|---|---|
| 0.1.1 version | `appStoreVersions` | `353d561b-06de-4921-ae54-2407d0ea8394` |
| Indie | `subscriptionVersions` | `46489f0d-80bb-4acd-8441-955ebab8bd03` |
| Startup | `subscriptionVersions` | `16d974c2-4dd0-4a17-bccd-85690c7b7319` |
| Scale | `subscriptionVersions` | `f62767b5-f7f3-435c-9c7b-f75af58fbd57` |

All three subscription versions are `READY_FOR_REVIEW`; the version is
`REJECTED` until a new build is attached to it. Attach the build FIRST, then add
the four items, then submit. Re-read the IDs before using them — a new
subscription version gets a new ID.

### Build 202609042158 — uploaded with a live key (verified 2026-09-04)

First build carrying a real RevenueCat key. `fastlane ios beta` → signed .ipa
(33 MB) → uploaded to App Store Connect. Not yet submitted; `upload_to_testflight`
deliberately stops short of review.

The key was verified **by reading it out of the uploaded .ipa**, not inferred
from the build succeeding — the guard proves the key was in the environment,
which is a different claim from it reaching the binary:

    Payload/ShipASO.app/EXConstants.bundle/app.config
    extra.revenueCat = {"ios": "appl_zxBw…", "android": ""}

Note the location: Expo bakes `extra` into `EXConstants.bundle/app.config`, NOT
into `main.jsbundle`. A grep of the JS bundle returns nothing for both a live
and an empty key, so it cannot tell them apart — the first check run here did
exactly that and had to be redone.

### The review token is live in ASC (verified 2026-09-04)

Read back out of App Store Connect and exchanged against production:
`POST /auth/review-exchange` → **HTTP 200** (garbage token → 400 as the negative
control). The reviewer's sign-in path is proven, not assumed. Token expires
2026-12-03.

### Open, not blocking the submission

- `ANTHROPIC_API_KEY` unset → `/health` `claude_reasoner: false`; the agent runs
  on the Workers AI / deterministic fallback, not Claude. A demo video implying
  Claude-authored copy would misstate what is running.
- A notifications permission prompt fires at first launch with no user action
  preceding it. Not a rejection cause on its own; reviewers dislike unexplained
  launch-time permission requests.
