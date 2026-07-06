/**
 * Code-based route tree (no file-based codegen — keeps the toolchain minimal).
 * Root = the shell layout; children are the migrated routes. PRD 02 owns only
 * the health route; each route PRD adds its own child + edgeRoutes entry.
 */
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { ShellLayout } from "./shell/ShellLayout.js";
import { Health } from "./routes/health.js";
import { DashboardRoute } from "./routes/dashboard.js";
import { SettingsRoute } from "./routes/settings.js";
import { AppDetailRoute } from "./routes/appDetail.js";
import { WarRoomRoute } from "./routes/warRoom.js";
import { RunRoute } from "./routes/run.js";
import { LoginRoute, PreviewRoute, ProofRoute } from "./routes/public.js";

const rootRoute = createRootRoute({ component: ShellLayout });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: DashboardRoute });
const healthRoute = createRoute({ getParentRoute: () => rootRoute, path: "/_shell/health", component: Health });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsRoute });
const appDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/apps/$id", component: AppDetailRoute });
const warRoomRoute = createRoute({ getParentRoute: () => rootRoute, path: "/apps/$id/war-room", component: WarRoomRoute });
const runRoute = createRoute({ getParentRoute: () => rootRoute, path: "/runs/$id", component: RunRoute });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginRoute });
const previewRoute = createRoute({ getParentRoute: () => rootRoute, path: "/preview", component: PreviewRoute });
const proofRoute = createRoute({ getParentRoute: () => rootRoute, path: "/proof", component: ProofRoute });

const routeTree = rootRoute.addChildren([
  indexRoute,
  healthRoute,
  settingsRoute,
  appDetailRoute,
  warRoomRoute,
  runRoute,
  loginRoute,
  previewRoute,
  proofRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
