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

## Install — any coding agent

The loop runs in your editor, on your machine, with your credentials. The 31
skills are plain Markdown runbooks over plain CLI tools, and the engine is
standard-library Python — so nothing here is tied to one vendor.

**Any agent (Codex, Cursor, Copilot, Gemini, Amp, Aider…):**

```bash
git clone https://github.com/airowe/store-ops && cd store-ops
```

Then point your agent at **`AGENTS.md`** — most read it automatically. That file
is the front door: the skills index, the credential rules, and how to run the
engine. Cursor, Copilot, and Gemini also get a pointer file that redirects there.

**Claude Code** additionally has a plugin installer:

```
/plugin marketplace add airowe/store-ops
/plugin install store-ops@store-ops
```

Either way, audit any listing — read-only, no credentials, no keys:

```bash
python3 lib/aso_rank_check.py --bundle com.burbn.instagram "photo,stories,reels"
```

You get a per-field ASO score of your live listing and the exact next skill to
run for each gap. → Full walkthrough + what you'll see: **https://shipaso.com/install**

### Zero install: point your agent at the hosted MCP

No clone, no key, no account:

```
claude mcp add shipaso --transport http https://api.shipaso.com/mcp
```

Your agent immediately gets `preview_app` — a real, measured teaser of any App
Store app (audit grade, lead organic rank, how many keywords crack the top 10)
— and `proof`, the aggregate rank-win record. The other ten tools (listing
audit, keyword gaps, rank check, screenshot scoring, competitor watch, war room,
localization gaps, draft copy, and the two Google Play audits) unlock with a
free `shipaso_` key from app.shipaso.com → Settings → Agent access; re-add the
server with `--header "Authorization: Bearer <key>"`. MCP is vendor-neutral, so
Cursor and any other MCP client work the same way. Every tool is read or draft;
nothing pushes to a live store. Details: `skills/shipaso-mcp/SKILL.md`.

## What's in this repo

ShipASO comes in two forms — run it yourself, or let the hosted agent run it
for you:

| Path | What |
|------|------|
| **`skills/` + `lib/`** | The **free OSS agent plugin** — 31 skills + the engine (Python, 200 tests). Runs in any coding agent; Claude Code also has a one-command installer. |
| **`cloud/`** | The **hosted autonomous agent** — a Cloudflare app (Workers + D1 + Cron + Pages) that runs the loop on a schedule and surfaces decisions for approval. Engine ported to TypeScript (2,160 tests). See `cloud/README.md` + `cloud/DEPLOY.md`. |
| **`commercial/`, `docs/`** | The offer, the launch posts, the landing page. |

The plugin is the **funnel** (discover the agent by running it); the hosted app
is the product (it keeps working while you build). Same engine, two surfaces.

**Run it yourself, or let it run itself:**

- **Free, in your editor** — install the plugin and run the loop yourself in
  whichever agent you already use. Your credentials, your machine, no cost.
  Start here ↓ (Install).
- **Hosted + autonomous** — connect an app by bundle id and an agent runs the
  loop on a weekly schedule: re-checking ranks, watching competitors, drafting
  the next optimization, surfacing each decision for you to approve. It's live:
  **https://app.shipaso.com**

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
| `issue-verify` | Check open issues against the source before working them — catches stale "this is missing" claims. |
| `aso-teardown` | Write a publishable long-form teardown of any app from public measured data. Never estimates revenue. |
| `aso-keyword-research` | Rank keywords from store autocomplete + competitor scrape + synonyms. **No paid data API.** |
| `aso-metadata-optimization` | Generate final copy at exact char limits + emit the push commands. Never auto-ships. |
| `aso-rank-check` | Read your organic App Store rank per keyword and log it over time — did the change land? **Free public iTunes API, no key.** |
| `store-ops` | Router for the full chain. |

**More reasoning — audit, risk, and research:**
| Skill | Does |
|-------|------|
| `aso-context` | Scaffold the per-app `context.md` every other ASO skill reads. Start here. |
| `aso-review-mine` | Mine your own reviews for the words real users use to describe the app. |
| `aso-offstore-mine` | Mine "best `<category>` apps" articles + YouTube for off-store discovery language. |
| `aso-localize-research` | Keyword + rank research per market (de-DE, ja-JP, es-MX…) instead of US-only. |
| `aso-competitor-watch` | Track competitors' listing changes over time — name, subtitle, price, rating. |
| `aso-screenshot-score` | Score a live screenshot set — count, device/aspect coverage, first-two story. |
| `aso-review-risk` | Flag copy that gets apps **rejected** — unverifiable claims, "#1", competitor names. |
| `aso-rejection-assistant` | Turn a rejection into a plan against the guideline the reviewer actually cited. |
| `aso-ppo-treatment` | Design a free screenshot A/B test (Product Page Optimization). |
| `aso-rank-monitor` | Run a keyword set on a cadence so you get **deltas**, not one snapshot. |

**Execution — App Store Connect (via the `asc` CLI):**
| Skill | Does |
|-------|------|
| `asc-metadata-write-lane` | Create the editable version, attach the build, push the copy — **stops before submit**. |
| `asc-metadata-sync` | Sync + validate metadata; migrate the legacy metadata format. |
| `asc-localize-metadata` | Translate and sync metadata across locales. |
| `asc-submission-health` | Preflight a submission, submit a build, monitor review status. |
| `asc-id-resolver` | Resolve app / build / version / group IDs from human-friendly names. |
| `asc-ppp-pricing` | Per-territory pricing by purchasing power. |
| `asc-shots-pipeline` | iOS screenshot capture via xcodebuild / simctl / AXe. |

**Execution — Google Play (via the `gplay` CLI):**
| Skill | Does |
|-------|------|
| `gplay-metadata-sync` | Listing sync, including Fastlane format. |
| `gplay-review-management` | Review monitoring, filtering, and responses. |
| `gplay-rollout-management` | Staged rollout orchestration and monitoring. |
| `gplay-vitals-monitoring` | Crashes, ANRs, performance, errors. |
| `gplay-screenshot-automation` | Android capture across devices/locales via adb + Espresso. |
| `gplay-ppp-pricing` | Region-specific pricing. |

**Hosted:**
| Skill | Does |
|-------|------|
| `shipaso-mcp` | Point your agent at the hosted ShipASO MCP server and drive the loop over it. |

Every `asc-*` / `gplay-*` skill that **writes** asks which API key to use before
it does — `asc` resolves credentials from a default profile, and with more than
one registered a push through the wrong one succeeds against the wrong account.

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
/plugin marketplace add airowe/store-ops
/plugin install store-ops@store-ops
```

## Open-core — what's free vs. hosted

**The plugin is free and MIT-licensed, forever.** Everything above — the full
audit → research → optimize → push → verify loop, both stores, all 31 skills —
runs locally with your own credentials at no cost. Use it, fork it, ship apps
with it. That's the whole product for anyone who's comfortable in a terminal.

The line for the **hosted tier** is *convenience, never capability*. The free
plugin is complete; the paid tier sells you out of the setup pain and the
remembering. The hosted agent is **live now** at
**https://app.shipaso.com** — connect an app and watch the loop run on a
schedule.

| | Free (this plugin) | Hosted agent |
|---|---|---|
| The 31 skills + full loop | ✅ all of it | ✅ same engine |
| Real volume data | BYO Apple/Google keys | guided setup |
| Rank tracking | run `aso-rank-check` by hand | **scheduled** weekly + history + delta alerts |
| Standing autonomy (weekly cron) | ❌ you re-run it | ✅ Indie / Startup / Scale |
| Apps | unlimited (it's local) | 1 (Free) · 3 (Indie) · 10 (Startup) · 50 (Scale) |
| Approval gate | you run the push | enforced in code — commands withheld until you approve |

The tiers:

| Tier | Price | What you get |
|------|-------|------|
| **Free** | $0 | Run the agent yourself in any coding agent. The whole loop, your machine. 1 connected app, manual runs only. |
| **Indie** | **$6.99/month** | The weekly autonomous sweep, up to 3 apps. It proposes, you approve, it ships. |
| **Startup** | **$19.99/month** | The weekly sweep across up to 10 apps, with rank history and competitor watch. |
| **Scale** | **$64.99/month** | Up to 50 apps plus the portfolio roll-up. For agencies and multi-app devs. |

We will **never** resell Apple/Google data through a shared account (that breaks
their ToS) — the hosted tier is BYO-credentials too, and we never hold your
store credentials; the push is a generated-commands handoff. What you pay for is
the guided onboarding, the scheduler, and the history. The differentiator isn't
the data — everyone has Apple's popularity numbers. It's that ShipASO *ships
the metadata and proves the rank moved.*

**→ Try the hosted agent: https://app.shipaso.com**

## License

MIT — see [LICENSE](./LICENSE).
