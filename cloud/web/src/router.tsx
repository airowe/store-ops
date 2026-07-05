/**
 * Code-based route tree (no file-based codegen — keeps the toolchain minimal).
 * Root = the shell layout; children are the migrated routes. PRD 02 owns only
 * the health route; each route PRD adds its own child + edgeRoutes entry.
 */
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { ShellLayout } from "./shell/ShellLayout.js";
import { Health } from "./routes/health.js";
import { Landing } from "./routes/landing.js";

const rootRoute = createRootRoute({ component: ShellLayout });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Landing });
const healthRoute = createRoute({ getParentRoute: () => rootRoute, path: "/_shell/health", component: Health });

const routeTree = rootRoute.addChildren([indexRoute, healthRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
