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
