/**
 * /_shell/health — the one route the new app OWNS in PRD 02 (see edgeRoutes).
 * A trivial liveness + build-surface indicator; proves the shell renders and the
 * spine is wired before any user-facing route migrates.
 */
import { hasApiBase, API_BASE } from "../config.js";

export function Health() {
  return (
    <section>
      <h1>Shell OK</h1>
      <p className="muted">
        TanStack web shell is live. Backend: {hasApiBase ? API_BASE : "demo (no API base)"}.
      </p>
      <p className="faint">Routes migrate here one at a time; everything else proxies to the legacy dashboard.</p>
    </section>
  );
}
