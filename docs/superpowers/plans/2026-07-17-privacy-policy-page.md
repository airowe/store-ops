# Privacy Policy Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static `/privacy` route to the ShipASO web app so the App Store Connect Privacy Policy URL resolves to a real, first-party privacy policy that matches the App Privacy declaration.

**Architecture:** Code-based TanStack Router (`cloud/web/src/router.tsx`). A static content view `PrivacyView` (no data fetch) exported through `routes/public.tsx`, registered at `/privacy`, with a per-route document title. Content sourced from `marketing/aso/shipaso/submission-prep.md §3` so it stays consistent with the App Privacy questionnaire.

**Tech Stack:** React 19 + Vite, TanStack Router, vitest + @testing-library/react.

## Global Constraints

- Content must match `submission-prep.md §3` — no invented data practices.
- Reuse existing CSS classes (`section`, `h1`, `h2`, `.muted`); introduce **no** new styles.
- Follow the existing code-based route pattern; do NOT introduce file-based routing.
- Contact address: `support@shipaso.com`. Effective date: `2026-07-17`.
- Commands (from repo root `/Users/adamrowe/Projects/store-ops`):
  - Tests: `cd cloud/web && npx vitest run <path>` (fall back to `./node_modules/.bin/vitest run <path>` if `npx` is intercepted in this shell).
  - Build: `cd cloud/web && npx vite build` (or `./node_modules/.bin/vite build`).

---

### Task 1: Privacy policy page + route + title

**Files:**
- Create: `cloud/web/src/features/public/PrivacyView.tsx`
- Create: `cloud/web/src/features/public/PrivacyView.test.tsx`
- Modify: `cloud/web/src/routes/public.tsx` (add `PrivacyRoute`)
- Modify: `cloud/web/src/router.tsx` (import + route + tree registration)
- Modify: `cloud/web/src/shell/pageTitle.ts` (add `/privacy` title)
- Modify: `cloud/web/src/shell/pageTitle.test.ts` (add `/privacy` case)

**Interfaces:**
- Produces: `PrivacyView` — `export function PrivacyView(): JSX.Element` (no props, static). `PrivacyRoute` — `export function PrivacyRoute(): JSX.Element`.
- Consumes: existing CSS classes only.

- [ ] **Step 1: Write the failing PrivacyView test**

Create `cloud/web/src/features/public/PrivacyView.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrivacyView } from "./PrivacyView.js";

describe("<PrivacyView />", () => {
  it("states the load-bearing claims that must match the App Privacy declaration", () => {
    render(<PrivacyView />);
    // Only email is collected, for magic-link sign-in.
    expect(screen.getByTestId("privacy-data-collected")).toHaveTextContent(/email/i);
    expect(screen.getByTestId("privacy-data-collected")).toHaveTextContent(/sign-in/i);
    // No tracking.
    expect(screen.getByTestId("privacy-no-tracking")).toHaveTextContent(/no tracking/i);
    // Store/API credentials are never persisted.
    expect(screen.getByTestId("privacy-credentials")).toHaveTextContent(/never (stored|persisted)/i);
    // Contact address present.
    expect(screen.getByTestId("privacy-contact")).toHaveTextContent("support@shipaso.com");
    // Effective date present.
    expect(screen.getByTestId("privacy-effective")).toHaveTextContent("2026-07-17");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cloud/web && npx vitest run src/features/public/PrivacyView.test.tsx`
Expected: FAIL — cannot resolve `./PrivacyView.js` (module not created yet).

- [ ] **Step 3: Create the PrivacyView component**

Create `cloud/web/src/features/public/PrivacyView.tsx`:

```tsx
/**
 * Privacy policy — the honest, minimal truth about what ShipASO collects. Sourced
 * from the same facts as the App Privacy declaration (submission-prep §3) so the
 * two can never drift: email for magic-link sign-in, no tracking, and Store/API
 * credentials treated as transient inputs that are never persisted. Static
 * content — the ASC Privacy Policy URL points here.
 */
export function PrivacyView() {
  return (
    <section>
      <h1>Privacy Policy</h1>
      <p className="muted" data-testid="privacy-effective">Effective 2026-07-17.</p>

      <p>
        ShipASO is built to collect as little as possible. This policy describes
        exactly what we handle and why.
      </p>

      <h2>What we collect</h2>
      <p data-testid="privacy-data-collected">
        The only personal data we collect is your <b>email address</b>, used to
        send you a one-time magic-link for sign-in (app functionality). It is
        linked to your account and is <b>never</b> used for tracking or
        advertising.
      </p>

      <h2>What we don’t do</h2>
      <p data-testid="privacy-no-tracking">
        No tracking. No ads. No third-party analytics SDKs. We do not sell or
        share your data, and we do not build advertising profiles.
      </p>

      <h2>Your App Store / Play credentials</h2>
      <p data-testid="privacy-credentials">
        To run an audit or push a change, ShipASO uses your own App Store Connect
        or Google Play credentials. These are <b>transient</b>: sent once over
        HTTPS to perform the action you asked for, and <b>never stored</b> on your
        device or on our servers.
      </p>

      <h2>On-device storage</h2>
      <p>
        The app keeps your session token in the device keychain and a cached copy
        of the last listing data you viewed (always labeled “cached”, never
        “live”). This stays on your device.
      </p>

      <h2>Contact</h2>
      <p data-testid="privacy-contact">
        Questions about this policy? Email{" "}
        <a href="mailto:support@shipaso.com">support@shipaso.com</a>.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cloud/web && npx vitest run src/features/public/PrivacyView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the PrivacyRoute**

In `cloud/web/src/routes/public.tsx`, add the import (alongside the other view imports):

```tsx
import { PrivacyView } from "../features/public/PrivacyView.js";
```

and add the route function (after `ProofRoute`):

```tsx
export function PrivacyRoute() {
  return <PrivacyView />;
}
```

- [ ] **Step 6: Register the route in the router**

In `cloud/web/src/router.tsx`:

Add `PrivacyRoute` to the public import (line 14):

```tsx
import { LandingRoute, LoginRoute, PreviewRoute, ProofRoute, BroadcastRoute, PrivacyRoute } from "./routes/public.js";
```

Add the route definition (after `proofRoute`, ~line 27):

```tsx
const privacyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/privacy", component: PrivacyRoute });
```

Add `privacyRoute` to the `routeTree.addChildren([...])` array (after `proofRoute`).

- [ ] **Step 7: Add the per-route title (failing test first)**

In `cloud/web/src/shell/pageTitle.test.ts`, add a case asserting `pageTitle("/privacy")` returns `"ShipASO · privacy"`. Match the existing test style in that file (read it first; add an `it(...)` or a table row consistent with what's there).

Run: `cd cloud/web && npx vitest run src/shell/pageTitle.test.ts`
Expected: FAIL — `/privacy` not yet mapped (returns bare `"ShipASO"`).

- [ ] **Step 8: Add the title mapping**

In `cloud/web/src/shell/pageTitle.ts`, add to the `EXACT` record (after the `/proof` line):

```ts
  "/privacy": `${SITE} · privacy`,
```

- [ ] **Step 9: Run the title test to verify it passes**

Run: `cd cloud/web && npx vitest run src/shell/pageTitle.test.ts`
Expected: PASS.

- [ ] **Step 10: Full public + shell tests + build**

Run: `cd cloud/web && npx vitest run src/features/public src/shell && npx vite build`
Expected: all public + shell tests PASS; build exits 0.

- [ ] **Step 11: Commit**

```bash
git add cloud/web/src/features/public/PrivacyView.tsx \
        cloud/web/src/features/public/PrivacyView.test.tsx \
        cloud/web/src/routes/public.tsx \
        cloud/web/src/router.tsx \
        cloud/web/src/shell/pageTitle.ts \
        cloud/web/src/shell/pageTitle.test.ts
git commit -m "feat(web): privacy policy page at /privacy (App Store Privacy Policy URL target)"
```

---

## After merge + deploy (not a plan task — recorded so it isn't forgotten)

1. Confirm `https://shipaso.com/privacy` renders the policy (not the SPA shell).
2. Set the ASC Privacy Policy URL:
   `asc localizations` (app-info type, en-US, app 6787632160) → privacyPolicyUrl = `https://shipaso.com/privacy`.
3. Complete the age-rating questionnaire: `asc age-rating edit --app 6787632160 …` (all "None" → 4+).

## Self-Review

- **Spec coverage:** PrivacyView (§Architecture 1) → Steps 1–4; PrivacyRoute (2) → Step 5; router (3) → Step 6; pageTitle (4) → Steps 7–9. Testing (both test files) → Steps 1, 7, 10. All spec parts mapped.
- **Placeholder scan:** no TBD/TODO; component and test code are complete and literal. Step 7 references "match the existing test style" — the implementer reads `pageTitle.test.ts` (a small existing file) and adds one consistent case; the assertion value (`"ShipASO · privacy"`) is given exactly.
- **Type/name consistency:** `PrivacyView` (no props) / `PrivacyRoute` names consistent across component, route, router import, and test. `EXACT` key `/privacy` matches the route `path: "/privacy"`. testIDs in the component (`privacy-data-collected`, `privacy-no-tracking`, `privacy-credentials`, `privacy-contact`, `privacy-effective`) match the test.
- **Scope:** single cohesive task — view + wiring + tests ship together; a reviewer couldn't accept the route without the view.
