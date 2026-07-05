/**
 * Strangler edge map — which paths the NEW TanStack app owns vs. proxy to the
 * legacy vanilla dashboard (cloud/public/app.js). This is the heart of the
 * route-by-route coexistence: each route PRD adds its path to `OWNED_PATHS` when
 * it cuts over, and the edge (or the dev proxy) routes accordingly. Pure so it's
 * the single tested source both the app and the edge worker consult.
 */
export type Surface = "web" | "legacy";

/** An owned path is a string (exact / prefix) or a RegExp (dynamic segments). */
export type OwnedPattern = string | RegExp;

/**
 * Paths (exact or prefix) the new app serves. Starts intentionally tiny — only
 * the shell's own health route — so PRD 02 changes NO user-facing routing.
 * PRD 03 adds "/settings", PRD 04 "/", etc.
 */
export const OWNED_PATHS: readonly OwnedPattern[] = [
  "/_shell/health",
  "/settings",
  "/",
  // App detail — exactly one segment after /apps. NOT /apps/:id/war-room (still
  // legacy until PRD 06), and NOT the bare /apps connect endpoint.
  /^\/apps\/[^/]+$/,
];

/** Decide which surface should serve a pathname. */
export function resolveSurface(pathname: string, owned: readonly OwnedPattern[] = OWNED_PATHS): Surface {
  const p = pathname.replace(/\/+$/, "") || "/";
  const isOwned = owned.some((o) => {
    if (o instanceof RegExp) return o.test(p);
    const b = o.replace(/\/+$/, "") || "/";
    return p === b || p.startsWith(b + "/");
  });
  return isOwned ? "web" : "legacy";
}
