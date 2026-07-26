/**
 * Shell chrome — decides, from the pathname, which layout a route gets. The
 * redesign introduces a two-column app shell (236px nav rail + main column) for
 * the authed command-center routes (dashboard, apps, runs, settings), while the
 * public marketing/auth surfaces keep the single centered column. Pure and
 * router-free so it unit-tests like the other shell helpers (edgeRoutes,
 * pageTitle, headerState).
 */

/** Which chrome wraps a route: the railed app shell, or the plain centered column. */
export type Chrome = "railed" | "plain";

/** The nav rail's items, in order. `key` also drives which one is "active". */
export type NavKey = "overview" | "apps" | "keywords" | "competitors" | "runs" | "settings";
export type NavItem = { key: NavKey; label: string; href: string; icon: string };

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "overview", label: "Overview", href: "/dashboard", icon: "◱" },
  // Apps has no fleet index of its own — the dashboard IS the app list.
  { key: "apps", label: "Apps", href: "/dashboard", icon: "▦" },
  { key: "keywords", label: "Keywords", href: "/keywords", icon: "⌗" },
  { key: "competitors", label: "Competitors", href: "/competitors", icon: "⚔" },
  { key: "runs", label: "Runs", href: "/runs", icon: "◈" },
  { key: "settings", label: "Settings", href: "/settings", icon: "⚙" },
];

/**
 * Authed, railed surfaces. Public routes (/, /login, /preview, /proof,
 * /privacy, /broadcast) and the health check stay on the plain centered column —
 * a signed-out marketing visitor never sees the app rail.
 */
const RAILED: readonly (string | RegExp)[] = [
  "/dashboard",
  "/settings",
  "/keywords",
  "/competitors",
  // "/runs" as a bare string also covers "/runs/:id" via the startsWith arm.
  "/runs",
  /^\/apps\/[^/]+(\/war-room)?$/,
];

/** The chrome for a pathname. Trailing slashes are normalized. */
export function chromeFor(pathname: string): Chrome {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const railed = RAILED.some((r) => (r instanceof RegExp ? r.test(p) : p === r || p.startsWith(r + "/")));
  return railed ? "railed" : "plain";
}

/** Which nav item the current path highlights (null when off-rail). */
export function activeNav(pathname: string): NavKey | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (p === "/dashboard") return "overview";
  if (p === "/settings") return "settings";
  if (p === "/keywords") return "keywords";
  if (p === "/competitors") return "competitors";
  // the index and a run detail both highlight Runs.
  if (p === "/runs" || /^\/runs\//.test(p)) return "runs";
  if (/^\/apps\//.test(p)) return "apps";
  return null;
}
