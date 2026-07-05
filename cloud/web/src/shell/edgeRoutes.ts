/**
 * Strangler edge map — which paths the NEW TanStack app owns vs. proxy to the
 * legacy vanilla dashboard (cloud/public/app.js). This is the heart of the
 * route-by-route coexistence: each route PRD adds its path to `OWNED_PATHS` when
 * it cuts over, and the edge (or the dev proxy) routes accordingly. Pure so it's
 * the single tested source both the app and the edge worker consult.
 */
export type Surface = "web" | "legacy";

/**
 * Paths (exact or prefix) the new app serves. Starts intentionally tiny — only
 * the shell's own health route — so PRD 02 changes NO user-facing routing.
 * PRD 03 adds "/settings", PRD 04 "/", etc.
 */
export const OWNED_PATHS: readonly string[] = ["/_shell/health"];

/** Decide which surface should serve a pathname. */
export function resolveSurface(pathname: string, owned: readonly string[] = OWNED_PATHS): Surface {
  const p = pathname.replace(/\/+$/, "") || "/";
  const isOwned = owned.some((base) => {
    const b = base.replace(/\/+$/, "") || "/";
    return p === b || p.startsWith(b + "/");
  });
  return isOwned ? "web" : "legacy";
}
