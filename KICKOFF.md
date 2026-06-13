# Kickoff prompt for Claude Code (paste the block below)

Open this repo in Claude Code and paste the prompt under the line. It orients a
fresh session on what store-ops is, its verified state, and the next steps.

---

You're working in **store-ops**, a freshly-extracted standalone repo (this is its
own repo now — no monorepo). It's an AI-native App Store Optimization product
with two surfaces sharing one engine:

- **`skills/` + `lib/`** — a free OSS Claude Code plugin (23 ASO skills + a
  Python engine, 158 tests). The full reason→ship→verify→watch loop: audit a live
  listing, research keywords on REAL rank + competitor data (no paid data API),
  optimize copy to exact char limits, hand off the asc/gplay push commands, then
  track ranks + competitors over time.
- **`cloud/`** — the hosted autonomous agent: a Cloudflare app (Workers + D1 +
  Cron + Pages) that connects an app, runs the loop on a schedule, and surfaces
  decisions for human approval. Engine ported to TypeScript (45 tests). The
  store-push is a generated-commands handoff (we never hold users' store creds);
  the approval gate is enforced in code (push commands withheld until approved).
- **`commercial/OFFER.md`** — the AI-native offer + tiers (Free → $49 one-time →
  $19/mo Autopilot → $149/mo Fleet). **`docs/`** — launch posts + landing page.

**Current state (all verified before extraction):**
- Python: `python3 lib/run_tests.py` → 158 tests pass.
- Cloud: `cd cloud && npm install && npm test` → 45 tests pass, `npm run
  typecheck` clean. The full loop was verified end-to-end locally
  (connect → agent run on live data → approval gate → asc/gplay commands).
- Git: one clean initial commit on `main`, no GitHub remote yet, no secrets in
  history. `cloud/wrangler.toml` still has a placeholder `database_id`.

**Read first:** `README.md` (repo map), `cloud/README.md` + `cloud/DEPLOY.md`
(how the hosted app runs + deploys), `commercial/OFFER.md` (the business).

**Before doing anything substantive:** run both test suites above to confirm the
repo is green on this machine. Then help me with whichever of these I ask for:

1. **Ship to GitHub** — create `airowe/store-ops` (public) and push `main`.
2. **Deploy the hosted app to Cloudflare** — follow `cloud/DEPLOY.md`: create the
   D1 database, put its id in `wrangler.toml`, apply `schema.sql`, deploy the
   Worker, deploy the Pages dashboard, point `public/config.js` at the Worker.
3. **Harden for real launch** (currently stubbed for the demo): swap the
   `X-User-Email` stub auth for magic-link/OAuth; wire Stripe at the tier gates;
   keep the store-push as a generated-commands handoff.
4. **The launch** — finalize `docs/` (the Show HN / X posts + landing page) and
   ship the OSS plugin as the funnel.

Tell me which one and I'll start. Confirm the tests are green first.

---

## Quick reference (commands)

```bash
# verify the repo
python3 lib/run_tests.py                      # 158 Python tests
cd cloud && npm install && npm test           # 45 TS tests
npm run typecheck                             # clean

# run the hosted app locally (two terminals)
cd cloud
npx wrangler d1 execute store_ops --local --file=./schema.sql   # once
npx wrangler dev --local --port 8787          # terminal 1: the Worker
cd public && python3 -m http.server 8788      # terminal 2: the dashboard
# then connect an app:
curl -X POST http://localhost:8787/apps -H "x-user-email: you@x.com" \
  -H "content-type: application/json" -d '{"bundle_id":"app.airowe.clarity"}'

# ship to GitHub (public)
gh repo create airowe/store-ops --public --source=. --remote=origin \
  --description="AI-native ASO: ships your metadata and proves the rank moved." --push
```
