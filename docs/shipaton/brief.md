# RevenueCat Shipaton 2026 — Brief (ShipASO)
Sources fetched: 2026-08 (RevenueCat blog, shipaton.com, Devpost, RevenueCat codelabs).

> **Fetch note:** the Devpost/RevenueCat pages 403 automated fetch from our
> environment; facts below are reconstructed from search-engine extracts of those
> pages. Anything marked ⚠️ must be confirmed on the live Devpost `/rules` +
> `/details` before submitting — do not treat weighted judging text here as verbatim.

## Key dates
- **Submission window:** Aug 1 – Sep 30, 2026. The app's **first public version must go live in this window** (App Store / Google Play / Samsung Galaxy Store).
- **Ship early:** be **live + downloadable ≥1 week before Sep 30** — "in review" does not count; judges must be able to download it.
- **Deadline confirmed (2026-08-08, search extract of Devpost):** Sep 30, 2026 **11:45 pm PDT**. The **#BuildInPublic engagement period** is Aug 1 (8:30 am PT) – Sep 30 (11:45 pm PT) — only posts in-window count.

## Eligibility
- Open worldwide to individuals/teams at the age of majority in their country. ⚠️ Confirm excluded regions + team-size cap.
- **Next Gen (student)** track: video + open-source repo, no store release required — not our path (ShipASO ships to the store).

## Submission requirements (checklist)
- [ ] App's first public version **live in-window** on a supported store.
- [ ] App **integrates the RevenueCat SDK** to power ≥1 in-app purchase (mandatory gate). ✅ done — see `docs/superpowers/plans/2026-08-01-revenuecat-iap-integration.md`.
- [ ] **Demo video ≤3 min**, uploaded to a **public platform (YouTube/Vimeo)**, link on the form; it must **show the app working on the target device** (confirmed 2026-08-08 via search extract). Script drafted: `docs/shipaton/devpost-draft.md`.
- [ ] **Devpost submission form** (app description, store link, video, RevenueCat details).
- [ ] For **#BuildInPublic**: links to public build-journey posts submitted on the Devpost form.

## Judging criteria (#BuildInPublic axes confirmed 2026-08-08 via search extracts; weights still unpublished)
9 award categories, >$700K cash. The ones ShipASO can realistically target:

| Award | What wins it |
|---|---|
| **#BuildInPublic** (our horse) | transparency & storytelling · engagement (did sharing spark discussion) · learning & iteration (did public feedback change the app) |
| **HAMM** (Help Apps Make Money) | clarity of monetization strategy · creativity (hybrid/unconventional) · financial viability |
| **Grand Prize** | most post-launch traction/growth (hardest for a B2B/niche tool) |
| **Design** | craft + polish |

## Required / sponsor tech
- **RevenueCat SDK** — mandatory, must genuinely power an IAP or RevenueCat Ads. ✅ integrated (native `purchasePackage`; server webhook reconciles tier).
- A real app store for the standard track.

## IP & rules traps
- **Hard gate:** no live in-window store release ⇒ ineligible. App-review lag is the classic killer — submit-to-review early.
- **RevenueCat integration must actually function** — a sandbox purchase must round-trip (webhook → tier).
- ⚠️ Confirm IP retention + prize tax/eligibility fine print.

## ShipASO strategy (decided)
- **Horse: ShipASO. Prize: #BuildInPublic.** It's the app whose *product is the growth loop* — the agent moves real organic ranks and can auto-post the proof. Meta-story: an AI that ships apps, entered in a ship-an-app hackathon, dogfooding on itself.
- **Caveat:** B2B/niche ⇒ slow revenue (weak for HAMM's financial-viability axis and for Grand Prize's traction axis). If a consumer app with faster monetization existed it would be a better HAMM/Grand-Prize horse; ShipASO is the strongest #BuildInPublic play.
- **Engine status:** the #BuildInPublic post engine (composer + `GET /apps/:id/buildinpublic-post` emitter) is built + tested (PR #445). The proof card (`shareCard.ts`) already existed.

## What actually wins #BuildInPublic (from the 2024 winner + judges' blog, 2026-08-08)
- **Audience size does NOT matter** (stated by the organizers). Cadence, transparency, and
  feedback-driven iteration do. The 2024 winner (Rudrank Riyam) posted regular tweets +
  daily video logs; the clincher was that **features users suggested in public shipped in
  the app** — documented evidence for the "learning & iteration" axis.
- **Engagement axis** = "did sharing spark useful discussion / inspire others", not reach.
  The Shipaton **Discord has a #post-engagement-boost channel** — post every update there.
- Wins/challenges BOTH count: the 0.1.0 four-guideline rejection is prime story material,
  not something to hide. Our playbook + post calendar: `docs/shipaton/buildinpublic-playbook.md`.

## Three things most likely to sink the entry
1. **Missing the store-live gate** — ship 0.1.1 early; app-review lag is the killer (0.1.0 already burned one review round).
2. **A non-functional IAP** — the sandbox purchase must actually apply the tier.
3. **Not narrating in public** — #BuildInPublic is judged on public posts; a public *repo* is not the same as a public *journey*.

## Open questions (verify on live Devpost — the human's browser; the sandbox egress-blocks Devpost/shipaton.com)
Resolved 2026-08-08 via search extracts: ~~deadline time/timezone~~ (Sep 30 11:45 pm PDT), ~~video host/length~~ (≤3 min, public YouTube/Vimeo, app on device), ~~#BuildInPublic criteria~~ (three axes as tabled above).
Still open: 1. Team-size cap. 2. Judging **weights**. 3. IP + prize tax/eligibility fine print. 4. Whether Next Gen requires the RevenueCat SDK. 5. The full Devpost form fields (confirm against `docs/shipaton/devpost-draft.md` before submitting).

## Related docs (store-ops)
- Integration plan: `docs/superpowers/plans/2026-08-01-revenuecat-iap-integration.md`
- Resubmit checklist: `marketing/aso/shipaso/resubmit-0.1.1-checklist.md`
- Status ledger: `docs/shipaton/registry.md`
