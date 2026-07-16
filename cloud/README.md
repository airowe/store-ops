# store-ops · Cloudflare-native autonomous ASO agent

A customer connects their app by **bundle id**. An autonomous agent then runs the
ASO loop on a **weekly schedule**: audit → research keywords on **real** rank +
competitor data → optimize copy to **exact char limits** → **prepare** the store
push (generated `asc`/`gplay` commands — never executed). A human approves the one
irreversible step (the push). That approval-gate-in-code is the core guarantee:
**we never hold the user's store credentials and never push on our own.**

This directory is the **Cloudflare-native hosted product**. It ports the
deterministic engine from the Python libs in [`../lib/`](../lib/) to TypeScript.

> **Status: scaffold.** The directory layout, D1 schema, config, and the
> load-bearing constants are in place. The engine, API, cron logic, and dashboard
> UI plug into this and are built next.

## Architecture

```
                         ┌─────────────────────────────────────────┐
                         │           Cloudflare Pages              │
   customer ───────────► │   public/  (dashboard: connect-app,     │
                         │            run timeline, approval gate) │
                         └───────────────────┬─────────────────────┘
                                             │  fetch(API_BASE)
                                             ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │                    Cloudflare Worker  (src/index.ts)                   │
   │                                                                       │
   │   fetch()  ─────────────►  src/api/    REST API (auth* + apps + runs  │
   │                                        + approval + push-commands)     │
   │                                                                       │
   │   scheduled() ──────────►  src/cron/   weekly loop  (0 9 * * 1, Mon)   │
   │      "0 9 * * 1"                       re-check ranks, watch comps,    │
   │                                        re-draft past threshold         │
   │                                                                       │
   │           both call ───►   src/engine/   PURE ported ASO logic         │
   │                            (rank · competitor · screenshots ·          │
   │                             keywords · optimize · loop · constants)    │
   └───────────────┬──────────────────────────────────┬────────────────────┘
                   │ env.DB                            │ fetch (free, no auth)
                   ▼                                   ▼
        ┌─────────────────────┐          ┌──────────────────────────────────┐
        │   Cloudflare D1     │          │   iTunes public APIs             │
        │   (SQLite) schema   │          │   /search → organic rank         │
        │   users·apps·runs·  │          │   /lookup → competitor + shots   │
        │   snapshots·        │          └──────────────────────────────────┘
        │   approvals·        │
        │   proposals         │          * auth + billing are STUBBED for the
        └─────────────────────┘            working demo (magic-link / Stripe-test)
```

The **push** is a generated command handoff only — the agent prepares
`asc`/`gplay` commands for the human to run; the product never executes a store
push and never stores App Store Connect / Play credentials.

## Project layout

```
cloud/
├── package.json          # scripts: dev · deploy · test · db:migrate · typecheck
├── wrangler.toml         # Worker + D1 (DB binding) + Cron Trigger (weekly)
├── tsconfig.json         # TypeScript strict
├── vitest.config.ts      # engine unit tests
├── schema.sql            # D1 schema (apply with db:migrate)
├── README.md             # you are here
├── public/               # dashboard (deploys to Cloudflare Pages)
│   └── index.html
└── src/
    ├── index.ts          # Worker entry: fetch() + scheduled()
    ├── engine/           # ported, PURE ASO logic (unit-tested)
    │   ├── constants.ts        # char limits, endpoints, weights, buckets
    │   ├── constants.spec.ts
    │   └── README.md           # module plan + Python lib mapping
    ├── api/              # REST API (fetch handler)
    │   └── README.md
    └── cron/             # weekly autonomy loop (scheduled handler)
        └── README.md
```

## D1 schema (tables)

| table                  | purpose |
|------------------------|---------|
| `users`                | `id, email, created_at` (stubbed auth — no password) |
| `apps`                 | `id, user_id, bundle_id, name, country, created_at` |
| `runs`                 | `id, app_id, status, created_at, reasoning_json` — status enum: `detected·researching·awaiting_approval·approved·rejected·shipped` |
| `rank_snapshots`       | `id, app_id, keyword, rank, total, checked_at` (time-series organic rank) |
| `competitor_snapshots` | `id, app_id, comp_id, name, version, rating, seen_at` |
| `approvals`            | `id, run_id, decision, decided_at` (the human gate; one per run) |
| `proposals`            | `id, run_id, field, value, char_count` (optimized copy per store field) |

## Run it locally

```bash
npm install

# (first time) create the D1 database, then paste the printed id into
# wrangler.toml -> [[d1_databases]].database_id
npx wrangler d1 create store_ops

# apply the schema to the LOCAL D1
npm run db:migrate:local

# run the Worker locally (local D1, scheduled() testable via the dev UI)
npm run dev
```

Run the engine unit tests:

```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit (strict)
```

To exercise the weekly cron locally, `wrangler dev` exposes a scheduled trigger;
hit `http://localhost:8787/__scheduled?cron=0+9+*+*+1` (wrangler's test path) to
fire `scheduled()` on demand.

## Deploy

```bash
# 1) ensure database_id is filled in wrangler.toml (from `wrangler d1 create`)
# 2) apply the schema to the REMOTE D1
npm run db:migrate

# 3) set secrets (stubbed auth + optional Stripe-test)
npx wrangler secret put SESSION_SECRET
npx wrangler secret put STRIPE_TEST_KEY      # optional

# 4) deploy the Worker (includes the Cron Trigger)
npm run deploy

# 5) deploy the dashboard to Cloudflare Pages
npx wrangler pages deploy public --project-name store-ops-dashboard
# then set API_BASE in public/index.html to the deployed Worker URL
```

## Source of truth

The engine is ported faithfully from [`../lib/`](../lib/). Load-bearing values
(char limits, iTunes endpoints, retry/backoff, screenshot scoring, keyword
weights/buckets, run lifecycle) live in
[`src/engine/constants.ts`](src/engine/constants.ts) and are locked by
`constants.spec.ts`.

## Broadcast tool (launch list)

One-time D1 migration (existing db):

```bash
npx wrangler d1 execute store_ops --remote --command "ALTER TABLE subscribers ADD COLUMN unsubscribed_at TEXT"
npx wrangler d1 execute store_ops --remote --command "CREATE TABLE IF NOT EXISTS broadcasts (id TEXT PRIMARY KEY, subject TEXT NOT NULL, recipient_count INTEGER NOT NULL, sender TEXT, sent_at TEXT NOT NULL DEFAULT (datetime('now')))"
```

Set the owner token (skip if `wrangler secret list` already shows it):

```bash
openssl rand -base64 32 | npx wrangler secret put BROADCAST_TOKEN
```

Then visit `/broadcast`, paste the token, compose (markdown, with a live
preview), send a test to yourself, and send to the list. Sending runs in the
background (`ctx.waitUntil`) in chunks of 20; a very large list may exceed the
Worker background budget — a Cloudflare Queue is the documented upgrade path
(see `docs/superpowers/specs/2026-07-16-broadcast-tool-design.md`). Every email
carries a one-click `List-Unsubscribe`; unsubscribes suppress the address
(`subscribers.unsubscribed_at`) and are skipped on future sends.
