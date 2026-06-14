# ShipASO — Operations Runbook

Operational reference for the hosted ShipASO app (codebase `store-ops`). One
Cloudflare Worker (API + engine + weekly cron) + a D1 database + two Pages sites.
All commands run from `cloud/`.

---

## 1. Live surfaces

| Surface | What | Cloudflare resource |
|---|---|---|
| `shipaso.com` | Marketing / landing site | Pages project `store-ops-site` |
| `app.shipaso.com` | Dashboard (connect-app, run timeline, approval gate) | Pages project `store-ops-dashboard` |
| `api.shipaso.com` | REST API + engine + cron | Worker `store-ops` (custom domain in `wrangler.toml`) |
| D1 `store_ops` | SQLite store: `users·apps·runs·rank_snapshots·competitor_snapshots·approvals·proposals` | bound as `env.DB` (id `30f6f8cf-90a5-4646-936f-8899ec4f62f6`) |
| Weekly cron | `0 9 * * 1` — every Monday 09:00 UTC, runs `scheduled()` re-optimization sweep | Cron Trigger on the Worker |

The Worker's `workers.dev` URL stays live alongside the custom domain, so
`api.shipaso.com` and the `*.workers.dev` URL both reach the same Worker.

---

## 2. Deploy

### Worker (API + engine + cron)

```bash
npm run deploy        # = wrangler deploy
```

Publishes the Worker, provisions/updates `api.shipaso.com` (DNS + cert via
`custom_domain = true`), and registers the `0 9 * * 1` cron trigger.

### Pages sites

```bash
# dashboard → app.shipaso.com
npx wrangler pages deploy public --project-name store-ops-dashboard --branch main

# landing → shipaso.com
npx wrangler pages deploy <landing-dir> --project-name store-ops-site --branch main
```

> **Production-branch gotcha:** a `wrangler pages deploy` **without `--branch main`**
> lands on a *preview* alias and does **NOT** update the live custom domain. Always
> pass `--branch main` (the production branch) when you intend to update the live
> site. If a deploy "succeeded" but `app.shipaso.com` / `shipaso.com` didn't change,
> this is almost always why — redeploy with `--branch main`.

After deploying the dashboard, confirm `public/config.js` points at the API:

```js
window.STORE_OPS = { API_BASE: "https://api.shipaso.com" };
```

(Empty `API_BASE` runs the dashboard on its built-in mock backend.)

---

## 3. Rollback

Cloudflare keeps prior Worker versions. To roll back the Worker:

```bash
npx wrangler deployments list      # find the prior version id
npx wrangler rollback              # roll back to the previous version
npx wrangler rollback <version-id> # or roll back to a specific version
```

Alternatively, redeploy a prior version by checking out the previous commit and
running `npm run deploy` again.

For Pages, redeploy the previous good build (re-run the `pages deploy ... --branch main`
from the prior commit), or promote an earlier deployment in the Cloudflare
dashboard.

---

## 4. Secrets & vars

Set secrets with `wrangler secret put NAME` (prompts for the value — never commit
values to `wrangler.toml`).

```bash
npx wrangler secret put SESSION_SECRET          # HMAC key for magic-link + session tokens (REQUIRED outside demo)
npx wrangler secret put STRIPE_TEST_KEY         # Stripe secret key (Bearer for REST API)
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # verifies Stripe-Signature on /billing/webhook
npx wrangler secret put STRIPE_PRICE_LAUNCH     # Price id — Launch Optimization ($49 one-time)
npx wrangler secret put STRIPE_PRICE_AUTOPILOT  # Price id — Autopilot ($19/mo)
npx wrangler secret put STRIPE_PRICE_FLEET      # Price id — Fleet Autopilot ($149/mo)
npx wrangler secret put TINYFISH_API_KEY        # routes iTunes calls through TinyFish (clean egress; REQUIRED in prod)
npx wrangler secret put RESEND_API_KEY          # Resend API key for magic-link email delivery
npx wrangler secret put RESEND_FROM             # verified sender, e.g. "ShipASO <login@mail.shipaso.com>"
```

Notes:
- `STRIPE_PRICE_*` and `RESEND_FROM` aren't truly secret — they may instead live in `[vars]`.
- Non-secret config in `[vars]` (`wrangler.toml`): `DEFAULT_COUNTRY`, `APP_ENV`,
  `DASHBOARD_ORIGIN` (`https://app.shipaso.com`), `COOKIE_DOMAIN` (`.shipaso.com`).

---

## 5. D1 (`store_ops`)

### Run a migration / ad-hoc SQL (remote)

```bash
# apply the full schema
npx wrangler d1 execute store_ops --remote --file=./schema.sql

# run a single statement
npx wrangler d1 execute store_ops --remote --command "ALTER TABLE apps ADD COLUMN foo TEXT"
```

Use `--local` instead of `--remote` against the local dev DB. `npm run db:migrate`
is the remote schema apply; `npm run db:migrate:local` is the local one.

### Snapshot retention

`rank_snapshots` and `competitor_snapshots` are time-series tables that **grow
weekly per app** (the cron writes new rows every Monday). They accumulate
unbounded — plan a retention/rollup policy (prune or aggregate old snapshots) as
app count grows. This is unbounded growth, not a leak; budget for it before it
becomes a D1 size problem.

---

## 6. Incidents

### Apple 403s iTunes
**Symptom:** rank/competitor lookups fail; engine sees 403 from iTunes `/search`
or `/lookup`. Apple blocks Cloudflare egress IPs.
**Fix:** ensure `TINYFISH_API_KEY` is set — it routes iTunes calls through
TinyFish Fetch (clean egress). If TinyFish itself is degraded, the engine has a
**direct-fetch fallback** (works locally / from non-blocked IPs but is blocked
from Cloudflare egress). Verify the key:
```bash
npx wrangler secret list   # confirm TINYFISH_API_KEY is present
npx wrangler tail          # watch live logs for the egress path being used
```

### Magic-link emails not arriving
**Symptom:** `/auth/request` succeeds but no email lands.
**Checks:**
- Confirm `RESEND_API_KEY` and `RESEND_FROM` are set. If `RESEND_API_KEY` is
  unset, the link is only **logged**, never emailed.
- `RESEND_FROM` must be a sender on a **verified** Resend domain.
- `npx wrangler tail` — the Worker logs the magic link (and any send error).
- Check the Resend dashboard for delivery/bounce status.

### Cron didn't run / digests not sent
**Symptom:** no weekly sweep on Monday, no digests.
**Checks:**
- `npx wrangler tail` while the cron fires (`0 9 * * 1`, Mon 09:00 UTC). The
  `scheduled()` handler logs a summary (`CronReport`) — confirm it appears.
- Trigger on demand locally: hit `http://localhost:8787/__scheduled?cron=0+9+*+*+1`
  under `wrangler dev`.
- Confirm the trigger registered: `npx wrangler deployments list` (cron is set on
  deploy; a Worker deploy re-registers it).

### Stripe webhook failing
**Symptom:** checkout completes but entitlements don't update; `/billing/webhook`
errors.
**Checks:**
- Verify `STRIPE_WEBHOOK_SECRET` matches the signing secret of the webhook
  endpoint in Stripe (mismatch → signature verification fails).
- In the Stripe dashboard → Developers → Webhooks, inspect recent **deliveries**
  for the endpoint (response codes, retry attempts, payloads).
- `npx wrangler tail` to see the verification error on the Worker side.

---

## 7. Going to production

Today's launch posture is demo-grade (test-mode Stripe, magic-link,
`APP_ENV=demo` header fallback). To go live:

1. ~~**Flip `APP_ENV`** off `demo` → `production` in `[vars]`.~~ **DONE** — the
   `X-User-Email` demo fallback is disabled; only signed session cookies
   authenticate. (Set back to `demo` only to re-open the stub for local testing.)
2. **Set `SESSION_SECRET`** (required outside demo — demo uses an insecure dev
   fallback): `npx wrangler secret put SESSION_SECRET`.
3. **Rotate all setup-time keys** and do a secret-hygiene review.
4. **Stripe live mode** (separate from the auth flip above — needed before the
   paid flow takes REAL money; test mode is fine until then):
   - In Stripe, toggle to **Live mode** and complete account activation
     (business + bank details) — Stripe won't process live charges otherwise.
   - Create a **live** restricted/secret key (`sk_live_…` / `rk_live_…`).
   - Create the live products/prices:
     `STRIPE_KEY=<live key> node cloud/scripts/stripe-setup.mjs --live`
     (the script refuses a live key WITHOUT `--live`, and refuses `--live`
     without a live key — two locks, no accidental live objects). It prints the
     three live `price_…` ids.
   - Register the **live** webhook for `…/billing/webhook` (events:
     `checkout.session.completed`, `customer.subscription.updated/.deleted`,
     `invoice.payment_failed/.payment_succeeded`) → capture its `whsec_…`.
   - Set the live secrets: `STRIPE_TEST_KEY` → the live key, the three
     `STRIPE_PRICE_*` → the live ids, `STRIPE_WEBHOOK_SECRET` → the live secret
     (all via `wrangler secret put`), then `wrangler deploy`.
5. **Verify `RESEND_FROM`** on a verified brand domain (e.g.
   `login@shipaso.com` once `shipaso.com` is verified in Resend).

**Readiness audit:** `GET /` is intended to return a readiness report (env/secret
checks) — to be wired. Use it as the pre-launch gate once available.

---

## Section list

1. Live surfaces
2. Deploy (Worker + Pages, with the `--branch main` gotcha)
3. Rollback
4. Secrets & vars
5. D1 (`store_ops`) — migrations + snapshot retention
6. Incidents (Apple 403s · magic-link email · cron · Stripe webhook)
7. Going to production
