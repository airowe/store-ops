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

This runs `build:combined` (legacy stamped root + the new app at `/_web.html` +
the generated `functions/_middleware.js`) and deploys it to the
`store-ops-web-preview` Pages project. Wrangler prints the `*.pages.dev` URL.
Needs a Cloudflare login (`wrangler login`) or `CLOUDFLARE_API_TOKEN`.

Click through every `OWNED_PATHS` route on the preview URL (login, preview,
proof, dashboard, an app detail, war room, a run/money screen). Legacy-owned
paths (e.g. the bare `/apps` connect endpoint) must still render the OLD UI —
that proves the middleware is routing, not just serving the new app everywhere.

## Promote to production (a deliberate, separate step)

Only after the preview looks right. This is NOT wired yet — it's a follow-up PR
so the cutover is explicit:

1. Wire `build:combined` into `deploy.yml`'s dashboard build so `main` deploys
   the combined bundle to `store-ops-dashboard` (instead of legacy-only), **or**
2. Narrow `OWNED_PATHS` to public routes only for the first production cutover
   (the strangler-as-designed — flip a few routes, watch, widen), then do (1).

Until that PR lands, merging to `main` never changes what production serves.
