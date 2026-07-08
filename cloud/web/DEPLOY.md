# Enabling the UI redesign (cloud/web)

The new TanStack app coexists with the legacy dashboard behind the strangler
edge map (`src/shell/edgeRoutes.ts` → `OWNED_PATHS`). Nothing serves it until you
deploy the **combined** bundle. This is deliberately **preview-first**: the
default enablement path cannot touch production `app.shipaso.com`.

## Two Pages projects, kept separate on purpose

| Project | What it serves | Deployed by |
|---|---|---|
| `store-ops-dashboard` | **production** `app.shipaso.com` (legacy dashboard today) | `deploy.yml` on every push to `main`, and `npm run deploy:dashboard` |
| `store-ops-web-preview` | an **isolated** `*.pages.dev` preview of the combined bundle | `npm run deploy:web-preview` only |

They share no branch and no project, so a preview deploy and a production
`main` deploy can never overwrite each other. That was the risk with a single
project: `deploy.yml` redeploys the legacy build to `store-ops-dashboard` on
every merge, so a preview living there would be clobbered (and vice-versa).

## Preview the redesign (safe — no production impact)

```bash
cd cloud
npm run deploy:web-preview
```

This runs `build:combined` (legacy stamped root + the new app at `/_web` +
the generated **`_worker.js`** advanced-mode router) and deploys it to the
`store-ops-web-preview` Pages project. Wrangler prints the `*.pages.dev` URL.
Needs a Cloudflare login (`wrangler login`) or `CLOUDFLARE_API_TOKEN`.

The build bakes `VITE_API_BASE=https://api.shipaso.com` into the bundle so the
preview talks to the real API (override the env var for a different backend).

Click through every `OWNED_PATHS` route on the preview URL (login, preview,
proof, dashboard, an app detail, war room, a run/money screen). Legacy-owned
paths (e.g. the bare `/apps` connect endpoint) must still render the OLD UI —
that proves the worker is routing, not just serving the new app everywhere.

### Two Pages runtime gotchas this setup already handles

Both were caught on the first real preview deploy — noted so nobody reintroduces them:

- **`*.html` is 308-redirected** to its extensionless form, so the worker
  rewrites owned paths to `/_web` (not `/_web.html`).
- **A `functions/` directory inside the deploy dir is served as static assets,
  never registered as a Function.** We use a single root `_worker.js` (advanced
  mode), which Pages always runs. Verify any change locally with
  `wrangler pages dev dist` BEFORE deploying — the unit tests cover the routing
  logic but cannot catch Pages runtime behavior.

## Seeing authenticated data on the preview

The session cookie is `Domain=.shipaso.com` — a browser will **only** send it to
`*.shipaso.com` hosts, never to `*.pages.dev`. So the raw `pages.dev` URL can
render the redesign but can't hold a real session (you'll see login / "couldn't
load your apps" for authed views). Public surfaces (login, preview, proof) work
regardless.

To see authed dashboards on the preview, put it on a `*.shipaso.com` host:

1. In the Cloudflare dashboard, add a **custom domain** to the
   `store-ops-web-preview` Pages project — e.g. `next.shipaso.com` (Pages →
   the project → Custom domains → add; Cloudflare provisions the cert).
2. **Sign in on `app.shipaso.com` first** (production), which sets the
   `.shipaso.com` session cookie. Then open `https://next.shipaso.com` — the
   cookie rides along automatically (same registrable domain), the API reflects
   the origin for credentialed CORS, and authed data loads.

   Do NOT initiate magic-link sign-in *from* the preview host: the callback
   redirects to `DASHBOARD_ORIGIN` (`app.shipaso.com`), so you'd bounce to the
   production dashboard. Sign in on prod, then visit the preview.

No API change is needed — CORS reflects any Origin and the cookie is already
`SameSite=None; Secure`. This is purely a Cloudflare custom-domain step.

## Promote to production (a deliberate, separate step)

Only after the preview looks right. This is NOT wired yet — it's a follow-up PR
so the cutover is explicit:

1. Wire `build:combined` into `deploy.yml`'s dashboard build so `main` deploys
   the combined bundle to `store-ops-dashboard` (instead of legacy-only), **or**
2. Narrow `OWNED_PATHS` to public routes only for the first production cutover
   (the strangler-as-designed — flip a few routes, watch, widen), then do (1).

Until that PR lands, merging to `main` never changes what production serves.
