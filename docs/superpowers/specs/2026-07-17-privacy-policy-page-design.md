# Privacy Policy Page — Design

**Date:** 2026-07-17
**Status:** Approved (design), ready for planning

## Goal

Add a static, first-party privacy policy page at `shipaso.com/privacy` so the App
Store Connect **Privacy Policy URL** points at real content — and that content
matches the App Privacy declaration exactly. Today `/privacy` returns the SPA
landing shell (no policy), which would risk an App Review rejection.

## Why

- ASC requires a Privacy Policy URL resolving to an actual privacy policy.
- The policy must be consistent with what we declare in the App Privacy
  questionnaire. Sourcing both from the same facts (`marketing/aso/shipaso/submission-prep.md §3`)
  guarantees consistency.

## Facts the policy states (from submission-prep §3 — the honest, minimal truth)

- **Data collected:** email address only, for magic-link sign-in (App
  Functionality). Linked to the user. **Not** used for tracking.
- **No tracking, no ads, no third-party analytics SDKs.**
- **Store/API credentials** (App Store Connect `.p8`, Play service-account):
  transient inputs — sent once over HTTPS to run an audit, **never persisted** on
  device (enforced by `credentials.neverPersisted.test.ts`) or server-side.
- **On-device storage:** session token (Keychain) + a cached copy of last-seen
  listing data (labeled "cached", never "live").
- **Contact:** support@shipaso.com
- **Effective date:** 2026-07-17

## Architecture (mirrors the existing public-route pattern)

Code-based TanStack Router (`cloud/web/src/router.tsx`), public routes exported
from `routes/public.tsx`, views in `features/public/`. Static content only — no
data fetch, so `PrivacyView` is simpler than `ProofView` (takes no `client`).

1. **`cloud/web/src/features/public/PrivacyView.tsx`** — static component
   rendering the policy in the honest facts above. Reuses existing CSS classes
   (`section`, `h1`, `h2`, `.muted`); introduces **no** new styles. Each
   load-bearing claim carries a `data-testid` so the test can pin it against
   drift from the ASC declaration.
2. **`cloud/web/src/routes/public.tsx`** — add
   `export function PrivacyRoute() { return <PrivacyView />; }`.
3. **`cloud/web/src/router.tsx`** — import `PrivacyRoute`, add
   `privacyRoute` at `path: "/privacy"`, register in the route tree.
4. **`cloud/web/src/shell/pageTitle.ts`** — add
   `"/privacy": ${SITE} · privacy` to `EXACT`.

## Hosting

No hosting change needed. Existing deep public routes (`/preview`, `/proof`,
`/login`) already client-route on the live Pages deploy, so the SPA fallback
already serves `index.html` for unmatched paths — `/privacy` will resolve the
same way.

## Testing (TDD)

- **`PrivacyView.test.tsx`** — asserts the policy renders the load-bearing
  claims: email-for-sign-in, "no tracking", credentials never persisted, contact
  address. This prevents the page silently drifting from the App Privacy
  declaration.
- **`pageTitle.test.ts`** — add a `/privacy → "ShipASO · privacy"` case.

## Out of scope (YAGNI)

- No separate `/terms` page.
- No cookie banner (no non-essential cookies).
- No CMS/markdown pipeline — plain JSX content.
- No footer-link wiring (a follow-up if desired).

## After merge + deploy

1. Set the ASC Privacy Policy URL to `https://shipaso.com/privacy`:
   `asc localizations` (app-info type, en-US).
2. Complete the age-rating questionnaire via `asc age-rating edit` (all "None"
   → expected 4+).

## Global constraints

- Content must match `submission-prep.md §3` — no invented data practices.
- Reuse existing CSS classes; no new styles.
- Follow the existing code-based route pattern; do not introduce file-based
  routing.
- Contact address: support@shipaso.com. Effective date: 2026-07-17.
