# PRD 09 — Public surfaces (preview · login · proof · landing)

> The logged-out surfaces: the try-before-signup preview (`previewView()`), the
> magic-link login (`loginView()`), the shared "proof" page, and — optionally —
> `docs/landing`. These are where SSR/SEO/first-paint matter most, and where
> TanStack Start is strongest. Lowest risk, deferrable with zero authed-surface
> impact; sequenced last so the authed migration proves the stack first.

## The move
Decide per surface: **keep as hand-tuned static HTML** (best first paint, no JS
needed) **or** fold into TanStack Start SSR (unifies the codebase, per-route
metadata). Recommended split below.

## Recommendation
- **Login (`loginView`)** → TanStack Start route (it's interactive + behind the
  same auth flow as the shell; cheap once PRD 02 exists).
- **Preview (`previewView`)** → TanStack Start **SSR** route: it's the
  try-before-signup funnel entry, so SSR first paint + crawlability directly
  help acquisition. Reuses `/preview` API via `@shipaso/api`.
- **Proof page** → SSR route with per-page `generateMetadata` (OG tags for
  shared wins).
- **`docs/landing`** → keep static for now; migrate only if it starts drifting
  from the app design. The `@shipaso/tokens` SoT already keeps it visually in
  sync without a code move.

## Deliverables
- `cloud/web/app/routes/{login,preview,proof}.tsx` (SSR where noted).
- Preview search + preview-audit rendering ported from `renderSearch()` /
  `renderCandidates()`; the honest "great shape / findings" states preserved.
- Per-route `<title>`/meta + OG tags (replacing the single static `index.html`
  head) for SEO on the funnel + proof pages.

## UI
- Preview must stay a **try-before-signup** experience, not a login wall; signup
  is gated at "Connect & run" (parity with today's `route()` logic).

## Honesty
- Preview audits render the same honest findings/empty states as the authed
  audit — no inflated "great shape" or fabricated scores.
- Share/proof cards state real, measured deltas only.

## TDD
- Port preview-flow E2E (search → preview audit → connect-gate).
- SSR snapshot: crawlable HTML for preview + proof (title/meta present without JS).

## Acceptance
- Login/preview/proof served by the new app (SSR where specified); funnel flow
  intact; crawlable markup verified.
- Landing unchanged but visually consistent via shared tokens.

## Coexistence / rollback
- Independent of the authed routes; can ship anytime after PRD 02, but sequenced
  last by choice. Rollback = revert each route to the legacy proxy.

## Dependencies
- **PRD 01, 02.** Independent of 03–07; do after the authed stack is proven.
