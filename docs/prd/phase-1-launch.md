# Phase 1 — Launch-Ready (the focus)

**Goal:** a no-fluff hosted product someone will pay for, plus a launch that
earns the first ~100 plugin installs and the first paying customer.

**Bar:** everything here is on the path from "install" to "rank moved, here's
proof." If a task isn't, it's Phase 2+. Ship the smallest honest version.

**Why this is the focus:** the engine, auth, billing, gates, cron, and approval
gate are *already built and live*. Phase 1 is not "build the product" — it's
"make the built product convert and get it in front of people." Lower risk, high
leverage.

---

## 1.1 — Conversion scaffolding (on-site)

The dashboard + landing exist; they don't yet *convert*. Add only the minimum.

### Pricing on the landing
- **What:** the four tiers (Free / Launch $49 / Autopilot $19mo / Fleet $149mo)
  on `shipaso.com`, with the one-line frame: **"the free plugin does it once;
  the paid agent does it weekly."**
- **Why:** a visitor clicking "Try the hosted agent" today has no price
  expectation. Pricing pre-qualifies and sets the upgrade anchor.
- **No fluff:** a simple 4-column grid (the landing already has the markup
  pattern). No pricing calculator, no toggle, no "contact sales."
- **Done when:** pricing is visible above the fold-2 on the landing and each tier
  CTA routes correctly (Free → repo; paid → app.shipaso.com).

### Time-to-value promise (steal from Revnu's "first audit in 48h")
- **What:** a concrete promise in the hero: **"Connect an app → first audit +
  rank baseline in minutes."** We already deliver this; we don't say it.
- **Done when:** the promise is in the hero and is *true* (connect → first run is
  in fact minutes — verify the cold-connect latency).

### Email capture for "maybe later"
- **What:** one email field ("get the launch / when Autopilot opens up") on the
  landing. Store somewhere dead-simple (a D1 table or a form service).
- **Why:** today every not-ready visitor is lost forever. This is the cheapest
  retention of intent.
- **No fluff:** one field, one button, no multi-step, no popup.
- **Done when:** an email submits and is captured; you can export the list.

## 1.2 — The activation moment (in-product)

The conversion event is **"oh, real data about MY app."** Make it unmissable.

- **Plugin output nudge** (done in Phase 0) — keep it to one honest line.
- **Dashboard first-run** — after connect, the very first thing the user sees is
  the audit grade + the lead keyword's *actual rank*, not a settings page. The
  Heathen-style "#44 for X, nowhere for the head term — here's the winnable
  angle" read is the hook. Confirm the dashboard leads with this.
- **The Approve moment** — make the proposal + reasoning legible and the Approve
  button obvious. The gate is the trust-builder; show the reasoning for every
  field (the engine already produces it).

## 1.3 — Retention primitive (the one that makes $19/mo stick)

`$19/mo` with a weekly cron churns if the user forgets why they pay. The
**weekly "what moved" digest is the product's heartbeat.**

- **What:** a weekly email per connected app: rank deltas (↑/↓/new/lost) for the
  tracked keywords, any competitor move, and — if a threshold crossed — "a new
  optimization is waiting for your approval → app.shipaso.com."
- **Why:** it's the recurring *reason to stay*. The cron already computes all of
  this (`runWeeklySweep` + `evaluateThreshold`); we just need to email the
  digest. Reuse the Resend `EmailSender`.
- **No fluff:** plain, scannable, one CTA. If nothing moved, a one-line "held
  steady — nothing needs you this week" (honesty > fake urgency).
- **Done when:** a connected app on Autopilot receives a real weekly digest with
  accurate deltas, and a threshold-crossed week links to the pending approval.

## 1.4 — The launch (earn the first 100)

Drafts exist (`docs/LAUNCH.md`, `docs/LAUNCH_X.md`). Phase 1 ships them.

- **Repo as the funnel** — the README is the landing page for developers. Make it
  launch-grade (see Phase 0 remaining): case study up top, a real-run GIF, the
  loop, one CTA.
- **Show HN** — finalize + post. This is the spike; it seeds the first
  stars/installs and the credibility the landing lacks (zero stars today).
- **X / buildinpublic thread** — post the thread; then keep posting the
  *product's own results* ("ran ShipASO on [app], here's the rank delta").
- **Reddit** — r/iOSProgramming, r/androiddev, r/SideProject: share the Heathen
  case study as a "how I found winnable keywords" post, not an ad.
- **Done when:** the posts are live, the repo is launch-grade, and we can see
  installs/connects arriving.

---

## Acceptance criteria for Phase 1

- A visitor sees pricing and a time-to-value promise on the landing.
- A "maybe later" visitor can leave an email.
- A connected Autopilot app receives an accurate weekly "what moved" digest.
- The launch posts are live and the repo is launch-grade.
- **The north star: the first paying customer**, and a digest they'd miss if it
  stopped.

## Explicitly NOT in Phase 1 (resist these)

- Self-serve plan management UI, usage dashboards, team seats.
- A web onboarding wizard / product tour.
- Fleet/agency portfolio features (Phase 3).
- Real-auth/billing hardening beyond what's live (Phase 4) — test-mode Stripe and
  magic-link are *fine to launch with* for an indie audience; flip APP_ENV to
  production and rotate keys, but don't gold-plate.
- New data sources / channels beyond what exists.

## Dependencies / sequencing

```
Phase 0 (funnel works)  →  1.1 conversion scaffolding  ─┐
                           1.2 activation moment        ─┼─→  1.4 launch
                           1.3 retention digest         ─┘   (digest can ship
                                                              just after launch)
```
Launch can go the moment 1.1 + 1.2 are done and the repo is launch-grade; the
retention digest (1.3) should land within the first week so early users feel it.

## Known build notes (things already in the code to reuse)

- Weekly cron + threshold logic: `cloud/src/cron/scheduled.ts`
  (`runWeeklySweep`, `evaluateThreshold`).
- Email sender interface: `cloud/src/auth.ts` (`EmailSender`,
  `ResendEmailSender`) — the digest reuses this.
- Tier gates: `cloud/src/billing.ts` (`canRunCron`, `appLimitForTier`).
- Rank deltas: the engine already records per-keyword rank snapshots over time.
