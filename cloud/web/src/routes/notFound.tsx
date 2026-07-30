/**
 * 404 — the app's answer for a path it does not serve (#356 Phase 3).
 *
 * Before this, an unknown path fell through the strangler edge to the legacy
 * dashboard, so a typo rendered a whole dashboard shell as though the
 * navigation had worked. Retiring `cloud/public/` removes that fallback.
 *
 * Two honesty decisions:
 *
 *  • It SAYS the path does not exist. Redirecting to /dashboard would turn a
 *    mistake into an apparently successful navigation — the same class of lie
 *    as showing a plausible number we never measured.
 *  • It does not guess WHY. We cannot tell a typo from a renamed route from a
 *    link that never existed, so it does not claim the page "moved" or "was
 *    deleted". It states what we know and offers real links out.
 *
 * `chromeFor()` gives an unknown path the plain centered column, not the nav
 * rail — a stale bookmark should not imply a signed-in session.
 */
export function NotFoundRoute() {
  return (
    <div className="notfound" data-testid="not-found">
      <div className="notfound-eyebrow">404</div>
      <h1 className="notfound-title">This page doesn't exist.</h1>
      <p className="notfound-body">
        The address you followed isn't a page in ShipASO. If you typed it, check the spelling; if
        you followed a link, it may have pointed somewhere we don't serve.
      </p>
      <div className="notfound-actions">
        <a className="notfound-btn is-primary" href="/dashboard">
          Go to your dashboard
        </a>
        <a className="notfound-btn is-ghost" href="/">
          Back to the home page
        </a>
      </div>
    </div>
  );
}
