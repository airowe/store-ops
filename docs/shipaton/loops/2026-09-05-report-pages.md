# Loop 2 — every public report is its own page (scoped 2026-09-05)

**Scoped by:** Adam ("Keep going"), after loop 1 (`2026-09-05-mcp-front-door.md`,
PR #528) finished at its ceiling. Same rules. **Ceiling, not a floor.**

## The finding this loop acts on

The memo's second move — "give away the thing only you can measure" — is
already half built. `docs/landing/report.html` and `GET /report/:appId` exist
and work: a real scored report for any App Store app, no signup, cached six
hours, per-app damped (verified live 2026-09-05: cold 18.6 s, cache hit 0.9 s).

But the page is **client-rendered**: one static HTML file that fetches JSON.
Every report shares one `<title>`, one description, one preview card, and none
of it is in the HTML a crawler or an unfurler sees. The memo's compounding
effect — *"each teardown is an indexable page for a real app name"* — does not
exist yet. The data does; the page does not.

## Goal

**`https://shipaso.com/r/<appId>` is a server-rendered page for that app:**
its own title and description built only from measured fields, the full
breakdown and ranks in the HTML, a canonical URL, and Open Graph tags — served
from the **same** cached JSON behind the **same** damper, so it adds zero
upstream load.

## Exit criteria (each verifiable, each fails today)

1. **`GET /r/:appId[?country=]` on the Worker returns `text/html`** with a
   per-app `<title>`, `<meta name="description">`, `<link rel="canonical">`,
   `og:title` / `og:description` / `og:url`, and the breakdown + measured ranks
   rendered in the markup. It calls the existing `reportByAppId` (so JSON and
   HTML share one cache entry) behind the existing `allowReport` damper. A
   spec proves compute runs once across a JSON call and an HTML call.
2. **Measured-or-nothing holds in the markup.** Unreadable field → "—"; null
   rank → "— not in top 200"; null score → "—"; the thin-read caveat renders
   when fewer than half the fields were readable. A spec feeds nulls and
   asserts no `null`, `undefined`, `NaN`, or fabricated `0` appears.
3. **Untrusted text is escaped.** App name, bundle id, and field notes
   containing `<script>` and quotes render inert (spec).
4. **Errors are honest HTML pages,** with the same messages as the JSON route:
   non-numeric id → 400; App Store unreachable → 503 with retry text;
   damper → 429. Never a bare 500.
5. **`report.html` links every rendered report to its page** ("Share this
   report" → `/r/<id>`); the `?appId=` deep link keeps working. `sitemap.xml`
   is unchanged (dynamic pages are link-discovered, and the sitemap guard
   requires listed pages to exist as files).
6. **Canonical origin is configurable, not assumed.** `REPORT_PAGE_ORIGIN` in
   `wrangler.toml [vars]` makes canonical/OG URLs `https://shipaso.com/r/…`;
   unset, the request origin is used, so the page is honest on api.shipaso.com
   alone. The `shipaso.com/r/*` Worker route is one flagged hunk Adam can drop
   — together with the var, so the canonical never points at a 404.
7. **Gates green** on every PR (cloud `tsc` + `vitest`, `packages` tests,
   docpaths linter).

## Not in this loop

- A per-app Open Graph **image**. The rasterizer (`packages/postedge`) is a
  native module and does not run on Workers; the static card is used.
- Competitor-move alerts (memo move 3). Separate loop.
- Anything public: no posts, no submissions, no merges, no secrets.

## PRs

| # | Branch | What |
|---|---|---|
| 1 | `loop/report-pages-scope` | This document |
| 2 | `loop/report-pages` | Criteria 1–6 |

## Log

- 2026-09-05 — scoped after loop 1's four PRs (#528–#531) went green.
- 2026-09-05 — Criteria 1–6: `loop/report-pages` → **#533**. Pure renderer
  (`reportPage.ts` under the API, added by that PR — 10 specs), router route + HTML error pages
  (8 route specs incl. a negative control), `report.html` share link,
  `REPORT_PAGE_ORIGIN` + the flagged `shipaso.com/r/*` route pair. Found and
  fixed on the way: the JSON route resolved the id *before* the cache, so
  every hit paid one lookup; now zero. Cloud suite 2914/2914, `tsc` clean.

## Status at hand-off

| Criterion | PR | State |
|---|---|---|
| 1–6 | #533 | open, green locally |
| 7 gates | #532, #533 | green at open; CI is the final word |

**Not done, by the rules:** nothing merged, deployed, posted. The zone route
in `wrangler.toml` could not be exercised locally; it is one isolated hunk,
paired with its var, and the PR body says how to drop both.
