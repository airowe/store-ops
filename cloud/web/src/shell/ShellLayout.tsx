/**
 * The app shell. Two chromes over the same routed <Outlet />:
 *  • "railed" — the authed command center: a 236px nav rail + a main column
 *    with its own sticky topbar (dashboard, apps, runs, settings).
 *  • "plain"  — the public/marketing centered column (landing, login, preview…).
 * `chromeFor(pathname)` (pure, tested) picks; the rail never shows to a
 * signed-out marketing visitor. Session comes from GET /auth/me over the shared
 * client, disabled in the no-API demo path so the shell renders offline.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { client } from "../api.js";
import { API_BASE, hasApiBase } from "../config.js";
import { Topbar } from "./Topbar.js";
import { RailTopbar } from "./RailTopbar.js";
import { NavRail } from "./NavRail.js";
import { headerState, type Session } from "./headerState.js";
import { pageTitle } from "./pageTitle.js";
import { chromeFor, activeNav } from "./shellChrome.js";
import { useWebMcp } from "../webmcp/useWebMcp.js";
import { ToolsPanel } from "../webmcp/ToolsPanel.js";

export function ShellLayout() {
  const { data } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => client.get<Session>("/auth/me"),
    enabled: hasApiBase,
    retry: false,
  });
  const session: Session = data ?? null;

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The WebMCP surface: this route's tools are offered to the visitor's own
  // browser agent, and swapped as they navigate. Registration is a no-op in a
  // browser without `navigator.modelContext`, which is still nearly all of them.
  const webmcp = useWebMcp({ pathname, client });
  useEffect(() => {
    document.title = pageTitle(pathname);
  }, [pathname]);

  if (chromeFor(pathname) === "railed") {
    const hs = headerState({ hasApiBase, session });
    const operator = hs.email ?? (hs.mode === "demoStub" ? "demo" : null);
    return (
      <div className="app-shell" data-testid="app-shell">
        <NavRail active={activeNav(pathname)} operator={operator} />
        <div className="app-main">
          <RailTopbar pathname={pathname} />
          <main className="app-content">
            <Outlet />
            <ToolsPanel {...webmcp} />
          </main>
        </div>
      </div>
    );
  }

  return (
    <>
      <Topbar apiBase={hasApiBase ? API_BASE : null} session={session} />
      <main className="wrap">
        <Outlet />
        <ToolsPanel {...webmcp} />
      </main>
    </>
  );
}
