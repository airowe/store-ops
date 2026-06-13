# Deploy store-ops to Cloudflare

Copy-paste steps. The whole product is one Worker (API + engine + cron) + a D1
database + a Pages site (the dashboard). Verified working locally; these are the
steps to put it live.

## Prerequisites

- A Cloudflare account, `npm install` already run in this dir, and
  `npx wrangler login` done once.

## 1. Create the D1 database

```bash
npx wrangler d1 create store_ops
```

Copy the `database_id` it prints into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`.

## 2. Apply the schema (remote)

```bash
npx wrangler d1 execute store_ops --remote --file=./schema.sql
```

## 3. Deploy the Worker (API + engine + weekly cron)

```bash
npm run deploy        # = wrangler deploy
```

This publishes the API at `https://store-ops.<your-subdomain>.workers.dev` and
registers the weekly cron trigger (`0 9 * * 1` — Mondays 09:00 UTC) that runs the
autonomous re-optimization pass.

## 4. Point the dashboard at the Worker

Edit `public/config.js`:

```js
window.STORE_OPS = { API_BASE: "https://store-ops.<your-subdomain>.workers.dev" };
```

(Leave it empty to run the dashboard on its built-in mock backend — useful for a
Pages-only preview before the Worker exists. It auto-falls-back if the Worker is
unreachable.)

## 5. Deploy the dashboard (Pages)

```bash
npx wrangler pages deploy public --project-name store-ops-dashboard
```

That's the whole product live: connect an app → the agent runs → review the
proposal in the dashboard → approve → it reveals the ship commands; the cron
re-runs weekly.

---

## Run it locally (to demo / develop)

Two terminals:

```bash
# terminal 1 — the Worker + a local D1
npx wrangler d1 execute store_ops --local --file=./schema.sql   # once
npx wrangler dev --local --port 8787

# terminal 2 — the dashboard
cd public && python3 -m http.server 8788
```

Set `public/config.js` API_BASE to `http://localhost:8787`, open
`http://localhost:8788`, connect `app.airowe.clarity` (Heathen), and click
through connect → run → approve.

Or exercise the API directly:

```bash
# connect an app (the agent runs immediately)
curl -X POST http://localhost:8787/apps \
  -H "x-user-email: you@example.com" -H "content-type: application/json" \
  -d '{"bundle_id":"app.airowe.clarity"}'

# the response has an id + runId; review the run:
curl http://localhost:8787/runs/<runId> -H "x-user-email: you@example.com"

# approve → reveals the asc/gplay push commands:
curl -X POST http://localhost:8787/runs/<runId>/approve \
  -H "x-user-email: you@example.com" -H "content-type: application/json" -d '{}'
curl http://localhost:8787/runs/<runId>/push-commands -H "x-user-email: you@example.com"
```

## What's real vs. stubbed (working-demo scope)

- **Real:** the engine (audit + live ranks + competitors + keyword reasoning +
  char-limit-validated copy), D1 persistence, the connect→run→approve loop, the
  weekly cron, both-store push-command generation, CORS, 45 passing tests.
- **Stubbed for the demo:** auth is a simple `X-User-Email` header (swap for
  magic-link / OAuth before real launch); billing is not wired (add Stripe at the
  tier gates); the store push is a **generated-commands handoff** by design — we
  never hold users' ASC/Play credentials.

## Tuning a run

A bare connect auto-seeds keywords from the app's name + genre. For sharper
results, pass real seeds + competitors when triggering a run:

```bash
curl -X POST http://localhost:8787/apps/<appId>/run \
  -H "x-user-email: you@example.com" -H "content-type: application/json" \
  -d '{"keywords":[{"keyword":"secular meditation","volume":60,"difficulty":30,"relevance":100}],
       "competitors":["Calm","Headspace","Hallow"]}'
```
