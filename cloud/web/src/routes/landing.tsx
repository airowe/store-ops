/**
 * "/" placeholder for the NEW app. In production the edge proxies "/" to the
 * legacy dashboard (it's not in OWNED_PATHS yet — PRD 04 migrates it), so this
 * only shows in local dev / when hitting the app directly.
 */
export function Landing() {
  return (
    <section>
      <h1>ShipASO dashboard</h1>
      <p className="muted">
        This is the new TanStack shell. The dashboard route migrates in PRD 04; until then the
        legacy app serves “/”.
      </p>
    </section>
  );
}
