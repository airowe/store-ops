# ShipASO — go-live checklist & deploy walkthrough

Work this top to bottom. Steps are ordered so each one de-risks the next. The
two ⚠️ items (deploy, rotate secrets) gate the launch; everything below seeds the
credibility you need before posting.

All commands run from `cloud/` unless noted. Wrangler is a dev dependency, so
prefer `./node_modules/.bin/wrangler …` (or `npm run …`) over a global install.

---

## 0. Pre-flight (already true — just confirm)

- ✅ Production surfaces live: `shipaso.com`, `app.shipaso.com`, `api.shipaso.com`, `shipaso.com/check-your-rank` all return 200.
- ✅ Quality gates green: `npm run typecheck` and `npm test` (344 passing).
- ✅ No schema change since last deploy → **no D1 migration needed** this round.

Re-verify the gates before deploying:

```bash
cd cloud
npm run typecheck && npm test
```

---

## 1. ⚠️ Deploy the latest code

The recent work (animated rank-movement dashboard, `GET /apps/:id/deltas`,
`GET /apps/:id/share-card.svg`, the keyword-sanitization + generic-500 hardening)
is committed but **not yet on production**. Two deploys: the Worker (API) and the
Pages dashboard.

**1a. Deploy the Worker (API at `api.shipaso.com`):**

```bash
cd cloud
npm run deploy            # = wrangler deploy (main = src/index.ts, name = store-ops)
```

**1b. Deploy the dashboard (Pages at `app.shipaso.com`):**

```bash
cd cloud
./node_modules/.bin/wrangler pages deploy public --project-name store-ops-dashboard
```

**1c. Verify the deploy landed.**

The `/apps/*` routes are auth-gated *before* route matching, so an unauthenticated
`curl` returns 401 whether or not the new routes exist — it can't confirm the
deploy. Use these signals instead:

```bash
# (i) Confirm a fresh Worker deployment exists (check the timestamp is now):
cd cloud
./node_modules/.bin/wrangler deployments list | head

# (ii) The dashboard is unauthenticated-visible — confirm Pages served the new
# build by checking the JS bundle contains the new card. Should print a match:
curl -s https://app.shipaso.com/app.js | grep -c "rankMovementCard"
curl -s https://app.shipaso.com/app.js | grep -c "share-card.svg"

# (iii) Sanity: the public preview route still 200s.
curl -s -o /dev/null -w "preview:%{http_code}\n" -X POST https://api.shipaso.com/preview \
  -H "content-type: application/json" -d '{"query":"calm"}'
```

If the `grep -c` counts are `0`, the Pages deploy didn't pick up the new
`app.js` — re-run 1b (Pages can also cache; a hard refresh / cache purge may be
needed). The truest end-to-end check is the smoke test in §4 (sign in, open an
app, see the animated card + share button).

---

## 2. ⚠️ Rotate the secrets shared during setup (issue #14)

During the Stripe go-live, the live key and webhook secret were typed in the
terminal in plaintext. Rotate them regardless of how careful we were — a live
payment key is the highest-value secret you hold.

1. **Stripe dashboard → Developers → API keys** → roll the live secret key.
2. **Stripe dashboard → Webhooks** → roll the signing secret for the endpoint.
3. Re-put both into the Worker (interactive — wrangler prompts for the value;
   you pass only the NAME):

   ```bash
   cd cloud
   ./node_modules/.bin/wrangler secret put STRIPE_SECRET_KEY
   ./node_modules/.bin/wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

4. Delete the old test key once live checkout is confirmed (issue #9):

   ```bash
   ./node_modules/.bin/wrangler secret delete STRIPE_TEST_KEY
   ```

5. Confirm the secret set:

   ```bash
   ./node_modules/.bin/wrangler secret list
   ```

---

## 3. Seed the first real `/proof` wins (the credibility move)

Right now `https://api.shipaso.com/proof` returns `0 wins`. Your launch kit's
central move is "screenshot the wins" — so **before** you post anywhere, give the
product real data to show:

1. Sign into `app.shipaso.com` and **connect your own apps**.
2. Run the agent on each (the "▶ Run agent now" button), or wait for the Monday
   cron. A win needs ≥2 distinct rank snapshots per keyword, so the share-a-win
   card and `/proof` strip light up only after the second pass — **connect now so
   the clock starts.**
3. Once a real climb lands, the dashboard's "Share this win" button produces the
   branded card, and `shipaso.com`'s proof strip un-hides automatically.

> Honesty bar: the share card and proof strip only ever show a *real* win (a
> climb or strong new entry), never a hold — so there's nothing to fake or
> embellish. That's the credibility asset; don't bypass it.

---

## 4. Smoke-test the funnel (5 minutes, do it yourself)

Walk the exact path a launch visitor will:

- [ ] `shipaso.com` loads, hero + boat mark render, no console errors.
- [ ] `shipaso.com/check-your-rank` — run the free rank check on a real app.
- [ ] `app.shipaso.com` — the try-before-signup preview runs a real audit.
- [ ] Connect → run → the run/approval screen shows reasoning + proposed copy.
- [ ] Approve → the push commands / Fastlane PR handoff reveal (nothing auto-pushes).
- [ ] The animated "Rank movement this week" card renders on the app detail view.
- [ ] A Stripe checkout in **live** mode completes (use a real card you control,
      then refund) — confirms the rotated keys + webhook work end-to-end.

---

## 5. Launch sequence (then hand off to LAUNCH_KIT.md)

Once 1–4 are green and you have at least one real win to screenshot:

1. **Soft-launch** to your own audience (X build-in-public). Seeds wins, catches bugs.
2. **Show HN** (Tue–Thu ~9–11am ET). Block the day to reply.
3. **Reddit** (r/iOSProgramming + r/androiddev), different day, lead with the free rank check.
4. **Product Hunt** once you have wins + a testimonial.
5. **Indie Hackers** build-in-public, ongoing.

Full copy for each is in `docs/LAUNCH_KIT.md`.

---

## Parked (not launch-gating)

- **Google Ads API** — response package drafted in `docs/google-ads-api/`; submit
  whenever the shipaso.com domain email + PDF are ready. Post-launch parallel track.
- **#25 competitor war room** — L build with a no-backfill data gap; documented on
  the issue. Build when there's real user demand.
