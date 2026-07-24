/**
 * Per-route document.title. The built index.html ships a single static
 * `<title>ShipASO · dashboard</title>`, so before this every route — including
 * the public landing page a cold visitor hits first — showed "dashboard" in the
 * tab, the SEO title, and link-preview cards. `pageTitle(pathname)` maps the
 * current path to an honest, human title; ShellLayout applies it on navigation.
 *
 * Pure and framework-free so it unit-tests without a router (matches the other
 * pure shell helpers: envPill, headerState, edgeRoutes).
 */
export const SITE = "ShipASO";

/** Exact-path labels. `/` is the marketing landing — bare site name, no suffix. */
const EXACT: Record<string, string> = {
  "/": SITE,
  "/dashboard": `${SITE} · dashboard`,
  "/login": `${SITE} · sign in`,
  "/preview": `${SITE} · free audit`,
  "/proof": `${SITE} · proof`,
  "/privacy": `${SITE} · privacy`,
  "/settings": `${SITE} · settings`,
};

/** Dynamic routes: [matcher, title]. An id must never leak into the title. */
const DYNAMIC: [RegExp, string][] = [
  [/^\/apps\/[^/]+\/war-room$/, `${SITE} · war room`],
  [/^\/apps\/[^/]+$/, `${SITE} · app`],
  [/^\/runs\/[^/]+$/, `${SITE} · run`],
];

export function pageTitle(pathname: string): string {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (p in EXACT) return EXACT[p];
  for (const [re, title] of DYNAMIC) if (re.test(p)) return title;
  return SITE;
}

/**
 * Short in-app heading for the railed topbar — the human word the redesign shows
 * in Fraunces at the top of the main column ("Overview", "Apps", "Settings").
 * Distinct from pageTitle (the tab/SEO title). Dynamic app/run headings ("Cal
 * AI") aren't known from the path alone, so they fall back to a stable noun the
 * detail views can visually supersede with the real name.
 */
const RAIL_HEADINGS: Record<string, string> = {
  "/dashboard": "Overview",
  "/settings": "Settings",
};

export function railHeading(pathname: string): string {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (p in RAIL_HEADINGS) return RAIL_HEADINGS[p]!;
  if (/^\/apps\/[^/]+\/war-room$/.test(p)) return "War room";
  if (/^\/apps\/[^/]+$/.test(p)) return "App";
  if (/^\/runs\/[^/]+$/.test(p)) return "Run";
  return SITE;
}
