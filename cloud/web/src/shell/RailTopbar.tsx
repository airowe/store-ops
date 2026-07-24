/**
 * RailTopbar — the sticky, blurred header of the railed command center. Left: a
 * Fraunces page heading derived from the path. Right: a visual search field, the
 * theme toggle, a notification bell (amber dot when something's pending), and the
 * primary green "+ Connect app". Presentational; the heading comes from a pure,
 * tested helper so no router state leaks in beyond the pathname string.
 */
import { Link } from "@tanstack/react-router";
import { ThemeToggle } from "./ThemeToggle.js";
import { railHeading } from "./pageTitle.js";

export function RailTopbar({ pathname, notifications = 0 }: { pathname: string; notifications?: number }) {
  return (
    <header className="rail-topbar" data-testid="rail-topbar">
      <h1 className="rail-title" data-testid="rail-title">{railHeading(pathname)}</h1>
      <div className="rail-topbar-spacer" />
      <div className="rail-search" aria-hidden="true" data-testid="rail-search">
        <span className="rail-search-icon">🔍</span>
        <span className="rail-search-ph">Search apps, keywords…</span>
      </div>
      <ThemeToggle />
      <div className="rail-bell" data-testid="rail-bell">
        <span aria-hidden="true">🔔</span>
        {notifications > 0 ? (
          <span className="rail-bell-dot" data-testid="rail-bell-dot">{notifications}</span>
        ) : null}
      </div>
      <Link to="/dashboard" className="btn primary rail-connect" data-testid="rail-connect">
        <span aria-hidden="true">+</span> Connect app
      </Link>
    </header>
  );
}
