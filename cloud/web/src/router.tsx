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
import { PortfolioRunsRoute } from "./routes/portfolioRuns.js";
import { PortfolioKeywordsRoute } from "./routes/portfolioKeywords.js";
import { PortfolioCompetitorsRoute } from "./routes/portfolioCompetitors.js";
import { NotFoundRoute } from "./routes/notFound.js";
import { LandingRoute, LoginRoute, PreviewRoute, ProofRoute, BroadcastRoute, PrivacyRoute, SupportRoute, TermsRoute } from "./routes/public.js";

const rootRoute = createRootRoute({ component: ShellLayout });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: LandingRoute });
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard", component: DashboardRoute });
const healthRoute = createRoute({ getParentRoute: () => rootRoute, path: "/_shell/health", component: Health });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsRoute });
const appDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/apps/$id", component: AppDetailRoute });
const warRoomRoute = createRoute({ getParentRoute: () => rootRoute, path: "/apps/$id/war-room", component: WarRoomRoute });
const runRoute = createRoute({ getParentRoute: () => rootRoute, path: "/runs/$id", component: RunRoute });
// Portfolio index screens (#356). "/runs" is declared BEFORE "/runs/$id" is
// irrelevant to TanStack (it matches on specificity, not order), but the two are
// distinct paths: the index lists every run, the detail is one run.
const portfolioRunsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/runs", component: PortfolioRunsRoute });
const portfolioKeywordsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/keywords", component: PortfolioKeywordsRoute });
const portfolioCompetitorsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/competitors", component: PortfolioCompetitorsRoute });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginRoute });
const previewRoute = createRoute({ getParentRoute: () => rootRoute, path: "/preview", component: PreviewRoute });
const proofRoute = createRoute({ getParentRoute: () => rootRoute, path: "/proof", component: ProofRoute });
const privacyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/privacy", component: PrivacyRoute });
// Terms of Use (EULA). Apple requires a FUNCTIONAL link from any screen selling
// an auto-renewable subscription; 0.1.0 ate a 2.1(a) for a legal link that 404'd.
const supportRoute = createRoute({ getParentRoute: () => rootRoute, path: "/support", component: SupportRoute });
const termsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/terms", component: TermsRoute });
const broadcastRoute = createRoute({ getParentRoute: () => rootRoute, path: "/broadcast", component: BroadcastRoute });

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  healthRoute,
  settingsRoute,
  appDetailRoute,
  warRoomRoute,
  runRoute,
  portfolioRunsRoute,
  portfolioKeywordsRoute,
  portfolioCompetitorsRoute,
  loginRoute,
  previewRoute,
  proofRoute,
  privacyRoute,
  supportRoute,
  termsRoute,
  broadcastRoute,
]);

/**
 * Unknown paths render the 404 (#356 Phase 3) instead of falling through the
 * strangler edge to the legacy dashboard. It renders INSIDE the shell, so it
 * gets the same chrome decision as any other route — `chromeFor()` gives an
 * unknown path the plain centered column rather than the authed nav rail.
 */
export const router = createRouter({ routeTree, defaultNotFoundComponent: NotFoundRoute });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
