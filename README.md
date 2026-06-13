# ShipASO

**The reason → execute ASO loop for App Store *and* Google Play.**

> The product is **ShipASO**; the codebase, this repo, and the Cloudflare
> services are named `store-ops`.

Every other AI ASO tool does one half. Advisory tools (and most "AI ASO agents")
*reason* about your listing then stop at the copy-paste boundary — and they
depend on a paid data API. Deploy CLIs (Fastlane, raw APIs) *execute* but have no
ASO brain. **ShipASO does both, on both stores, with no paid data dependency.**

> **The open lane: Google Play.** There is no public tool that operationally
> optimizes a Google Play Console listing end-to-end. ShipASO does iOS *and*
> Android.

## What's in this repo

ShipASO comes in two forms — run it yourself, or let the hosted agent run it
for you:

| Path | What |
|------|------|
| **`skills/` + `lib/`** | The **free OSS Claude Code plugin** — 23 skills + the engine (Python, 158 tests). Run the whole loop yourself in your editor. |
| **`cloud/`** | The **hosted autonomous agent** — a Cloudflare app (Workers + D1 + Cron + Pages) that runs the loop on a schedule and surfaces decisions for approval. Engine ported to TypeScript (45 tests). See `cloud/README.md` + `cloud/DEPLOY.md`. |
| **`commercial/`, `docs/`** | The offer, the launch posts, the landing page. |

The plugin is the **funnel** (discover the agent by running it); the hosted app
is the product (it keeps working while you build). Same engine, two surfaces.

**Run it yourself, or let it run itself:**

- **Free, in your editor** — install the plugin and run the loop yourself in
  Claude Code. Your credentials, your machine, no cost. Start here ↓ (Install).
- **Hosted + autonomous** — connect an app by bundle id and an agent runs the
  loop on a weekly schedule: re-checking ranks, watching competitors, drafting
  the next optimization, surfacing each decision for you to approve. It's live:
  **https://store-ops-dashboard.pages.dev**

## What it does

```
audit  →  research keywords  →  optimize to char limits  →  push  →  verify rank
(asc/gplay) (no paid API)        (ready copy + commands)   (you approve) (free, over time)
```

**The full loop, not half of it.** The data tools (Astro, AppTweak, Sensor Tower)
stop at "here's what to do" and leave you in the App Store Connect form. ShipASO
*picks the keywords, writes the metadata, hands you the push, and then verifies the
rank actually moved* — the only piece that closes the loop and the one nobody else
ships.

```
/store-ops myapp                     # full chain, both stores
/store-ops myapp --store playstore   # Google Play only
/store-ops myapp --audit-only        # just score the live listing
```

## Try it in 30 seconds (no credentials, no setup)

The verify/watch half runs on the free public iTunes API — try it on any live
app right now:

```bash
# organic App Store rank for some keywords (any app's bundle id)
python3 lib/aso_rank_check.py \
    --bundle com.burbn.instagram "photo,stories,reels"

# score an app's screenshots against ASO best practice
python3 lib/aso_screenshot_score.py \
    --app instagram --bundle com.burbn.instagram

# resolve a non-US market's keyword-volume + rank constants
python3 lib/aso_locale.py --locale de-DE
```

Run the test suites (standard-library only — no network, no keys):

```bash
python3 lib/run_tests.py
```

## Skills

**Reasoning (the IP):**
| Skill | Does |
|-------|------|
| `aso-audit` | Score a live iOS/Android listing field-by-field vs ASO best practice. Read-only. |
| `aso-keyword-research` | Rank keywords from store autocomplete + competitor scrape + synonyms. **No paid data API.** |
| `aso-metadata-optimization` | Generate final copy at exact char limits + emit the push commands. Never auto-ships. |
| `aso-rank-check` | Read your organic App Store rank per keyword and log it over time — did the change land? **Free public iTunes API, no key.** |
| `store-ops` | Router for the full chain. |

**Execution (bundled, via the asc / gplay CLIs):**
metadata sync, localization, PPP pricing, screenshots, submission health,
reviews, rollout, vitals — for both App Store Connect and Google Play Console.

## Principles

- **No paid data dependency** — reasons over free + owned data (store autocomplete,
  public listings, your own asc/gplay exports). Every credentialed source is an
  *optional accelerator with a free fallback*, never a gate:
  - *volume* — bring your **own** Apple Search Ads / Google Keyword Planner keys for
    real search-popularity numbers; without them, an honest autocomplete-rank proxy.
  - *scrape* — bring a **context.dev** key for clean competitor-listing + brand-data
    scraping; without it, WebFetch / Crawl4AI.
  You bring your own keys (it's *your* data, ToS-clean); the plugin never resells data.
- **Both stores, official APIs.**
- **Nothing ships without your approval** — reasoning writes copy + prints
  commands; you run the push.
- **App-agnostic** — `--app <slug>` + a `context.md`. No hardcoded apps, no
  secrets in the plugin.

## Requirements

- To **execute**: the [`asc`](https://github.com/rudrankriyam/App-Store-Connect-CLI)
  and `gplay` CLIs installed + authed with your own developer credentials.
- The **reasoning** skills work standalone (they emit commands you can run later).

## Install

```
/plugin marketplace add airowe/app-marketplace
/plugin install store-ops
```

## Open-core — what's free vs. hosted

**The plugin is free and MIT-licensed, forever.** Everything above — the full
audit → research → optimize → push → verify loop, both stores, all 23 skills —
runs locally with your own credentials at no cost. Use it, fork it, ship apps
with it. That's the whole product for anyone who's comfortable in a terminal.

The line for the **hosted tier** is *convenience, never capability*. The free
plugin is complete; the paid tier sells you out of the setup pain and the
remembering. The hosted agent is **live now** at
**https://store-ops-dashboard.pages.dev** — connect an app and watch the loop
run on a schedule.

| | Free (this plugin) | Hosted agent |
|---|---|---|
| The 23 skills + full loop | ✅ all of it | ✅ same engine |
| Real volume data | BYO Apple/Google keys | guided setup |
| Rank tracking | run `aso-rank-check` by hand | **scheduled** weekly + history + delta alerts |
| Apps | unlimited (it's local) | unlimited |
| Approval gate | you run the push | enforced in code — commands withheld until you approve |

The tiers:

| Tier | Price | What you get |
|------|-------|------|
| **Free** | $0 | Run the agent yourself in Claude Code. The whole loop, your machine. |
| **Launch Optimization** | **$49 one-time** | The agent does a full optimization pass on one app, en-US. +$29/locale, +$39 for the Google Play variant. |
| **Autopilot** | **$19/month** | It keeps working: weekly rank tracking, competitor watch, self-triggered re-optimization you approve. |
| **Fleet Autopilot** | **$149/month** | Both stores, multiple locales, multiple apps, a portfolio dashboard. For agencies and multi-app devs. |

We will **never** resell Apple/Google data through a shared account (that breaks
their ToS) — the hosted tier is BYO-credentials too, and we never hold your
store credentials; the push is a generated-commands handoff. What you pay for is
the guided onboarding, the scheduler, and the history. The differentiator isn't
the data — everyone has Apple's popularity numbers. It's that ShipASO *ships
the metadata and proves the rank moved.*

**→ Try the hosted agent: https://store-ops-dashboard.pages.dev**

## License

MIT — see [LICENSE](./LICENSE).
