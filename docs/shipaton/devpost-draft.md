# Devpost submission draft + demo video script (ShipASO)

Draft to paste into the Devpost form once 0.1.1 is live. Placeholders in
`[brackets]` are facts we don't have yet — measured-or-nothing applies to
marketing too. Confirm the live form's actual fields before submitting (the
sandbox can't fetch Devpost; check in a browser).

---

## App name + one-liner

**ShipASO: Keyword Ranks** — an AI ASO agent that ships your App Store
metadata and proves the rank moved.

## Inspiration

Every indie developer's App Store listing is a guess: pick keywords, write a
subtitle, hope. The data to do better exists — real organic keyword ranks,
competitor listings, week-over-week deltas — but reading it weekly and acting
on it is a job nobody keeps doing. We built the employee that does: an
autonomous agent that audits, watches, proposes, and — after a human approves —
ships metadata, then measures whether it actually worked.

Then we entered it in Shipaton, which makes the entry itself the dogfood: an AI
agent that ships apps, shipping its own app, posting its own receipts.

## What it does

- **Audits** your listing and watches competitors weekly, unattended (Cloudflare
  Cron), on real public App Store data.
- **Proposes** concrete metadata changes (subtitle, keyword field) with the
  reasoning attached. **A human approves — approving is not shipping; the push
  to the store is a separate, explicit, human click.** The agent never touches
  your listing on its own.
- **Proves it.** Every number in the product is measured or absent — an unread
  rank renders "—", never a placeholder. When a rank genuinely moves, the app
  renders a branded proof card (#40 → #12, up 28 spots) you can share; holds
  and slips are never dressed up.
- **The growth loop is the product:** a genuine win composes a ready-to-post
  #BuildInPublic update — proof card, store link, real numbers — and the
  posting edge publishes it. ShipASO markets itself with its own results, and
  ours is the first account it runs on.

## How we built it

Cloudflare-native: Workers + D1 + Cron + Pages, with a React web dashboard and
an Expo (React Native) iOS app over a shared design-token/logic spine. An MCP
server exposes the read-only audit tools to AI agents. The store-facing
pipeline is Fastlane. And in the build-in-public spirit: the codebase is
substantially written by an AI coding agent, PR by PR, with the journey posted
as it happened.

## How RevenueCat powers monetization

Three subscription tiers (Indie / Startup / Scale) sold two ways:

- **In-app:** `react-native-purchases` — offerings-driven paywall,
  StoreKit purchase, Restore Purchases, full auto-renewal disclosures.
- **Web:** the same tiers via Stripe.
- **The interesting part:** the server stays the single source of truth for
  entitlements. A verified RevenueCat webhook maps product → tier; the
  effective tier is the **highest active entitlement from either source**, and
  the paywall detects an active web subscription and shows a read-only
  "managed on the web" state instead of a Buy button — so nobody can ever be
  double-charged. Hybrid billing without the usual hybrid-billing footguns.

## Challenges we ran into

Apple rejected 0.1.0 on four guidelines in one review — IP in the app name,
payments (we'd removed purchasing entirely rather than build IAP), a
magic-link that opened a 404, and screenshot metadata. We published the whole
rejection and fixed all four in public; the payments fix became the RevenueCat
integration this submission is built on. [Update with the 0.1.1 review
outcome.]

## Accomplishments / what we learned / what's next

[Fill from the journey ledger the week of submission — real numbers only:
ranks moved, posts and the discussion they sparked, features shipped from
public feedback. The ledger + links live in
`docs/shipaton/buildinpublic-playbook.md`.]

## Built with

expo · react-native · typescript · cloudflare-workers · d1 · revenuecat ·
stripe · fastlane · resvg · mcp

## Links (form fields)

- App Store: [0.1.1 link]
- Demo video: [YouTube link, ≤3 min — script below]
- #BuildInPublic posts: [paste the ledger's link column]
- Repo/journey: [decide: the repo is private; the journey lives in the posts]

---

## Demo video script (target 2:30, hard cap 3:00)

Rules confirmed: public YouTube/Vimeo, must show the app working on the target
device. Screen-record the phone for app segments; screen-record the desktop for
the loop segment. No music over narration; captions on.

| Time | Shot | Narration (spoken) |
|---|---|---|
| 0:00–0:15 | Proof card PNG full-screen: "budget tracker #40 → #12" | "This is a real App Store keyword rank. An AI agent moved it — and then posted this card itself. ShipASO is that agent." |
| 0:15–0:40 | iPhone: magic-link email → tap → app opens signed in → portfolio | "Sign in with a magic link. ShipASO audits your listing and reads your real organic keyword ranks every week, unattended." |
| 0:40–1:10 | iPhone: rank deltas screen; point at a "—" | "Every number here is measured or absent. That dash means 'never read' — ShipASO never shows you a placeholder. When it has a proposal, it shows you exactly what to change and why — and nothing ships until you approve it. Approving is a decision; pushing is a separate click. The agent never touches your listing on its own." |
| 1:10–1:40 | iPhone: locked screen → paywall → **sandbox purchase completes** → tier unlocks | "Subscriptions are in-app purchases powered by RevenueCat. The server verifies the purchase through a webhook and unlocks the tier — and if you already subscribed on the web, the app knows, and will never charge you twice." |
| 1:40–2:15 | Desktop: a rank win in the dashboard → terminal runs the posting edge → card.png appears → the posted tweet with the card | "Here's the part we entered Shipaton with: when a rank genuinely moves, ShipASO composes the announcement, renders the proof, and posts it. Holds and slips post nothing — it only ever brags with receipts." |
| 2:15–2:30 | The X timeline of build-in-public posts, scrolling | "ShipASO is dogfooding itself for Shipaton — its own ranks, its own posts, built in public. Come watch it work." |

Retake checklist: app on a REAL device (rule), sandbox purchase actually
completes on camera, no price text visible that contradicts store screenshots,
"—" close-up included (it's the honest differentiator), total under 3:00.
