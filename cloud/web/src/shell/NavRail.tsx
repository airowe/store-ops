/**
 * NavRail — the 236px sticky left rail of the authed command center. Logo →
 * PORTFOLIO label → nav items (Overview active by path, …, Runs with an amber
 * pending badge, Settings) → user chip. Presentational: the active item and the
 * pending-run badge are passed in, derived from tested helpers / real data, so
 * the rail render-tests without a router or network.
 */
import { Link } from "@tanstack/react-router";
import { NAV_ITEMS, type NavKey } from "./shellChrome.js";

export function NavRail({
  active,
  pendingRuns = 0,
  operator,
}: {
  active: NavKey | null;
  pendingRuns?: number;
  operator: string | null;
}) {
  const initials = (operator ?? "").slice(0, 2).toUpperCase() || "··";
  return (
    <aside className="nav-rail" data-testid="nav-rail">
      <Link to="/dashboard" className="rail-logo" data-testid="rail-logo">
        <span className="tick" aria-hidden="true">✓</span>
        ShipASO
      </Link>
      <div className="rail-eyebrow">Portfolio</div>
      <nav className="rail-nav">
        {NAV_ITEMS.map((n) => (
          <Link
            key={n.key}
            to={n.href}
            className={"rail-item" + (n.key === active ? " active" : "")}
            data-testid={`nav-${n.key}`}
            aria-current={n.key === active ? "page" : undefined}
          >
            <span className="rail-icon" aria-hidden="true">{n.icon}</span>
            <span className="rail-label">{n.label}</span>
            {n.key === "runs" && pendingRuns > 0 ? (
              <span className="rail-badge" data-testid="nav-runs-badge">{pendingRuns}</span>
            ) : null}
          </Link>
        ))}
      </nav>
      <div className="rail-spacer" />
      {/*
        Signed out, the chip used to read "You" over "Fleet" — a name for
        nobody and a plan nobody is on — and the rail offered no route to
        /login, so an expired session on /settings was a dead end. An absent
        operator is stated as absent, and the way back in is offered.
      */}
      <div className="rail-user" data-testid="rail-user">
        <span className="rail-avatar" aria-hidden="true">{operator ? initials : "··"}</span>
        <div className="rail-user-meta">
          {operator ? (
            <>
              <div className="rail-user-name">{operator}</div>
              <div className="rail-user-sub">Fleet</div>
            </>
          ) : (
            <>
              <div className="rail-user-name">Signed out</div>
              <Link to="/login" className="rail-user-sub rail-signin" data-testid="rail-signin">
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
