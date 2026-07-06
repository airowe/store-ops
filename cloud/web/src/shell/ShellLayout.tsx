/**
 * The app shell — topbar + centered content column, wrapping every route via the
 * router's <Outlet />. Session comes from GET /auth/me over the shared client
 * (React Query), disabled in the no-API demo path so the shell renders offline.
 */
import { useQuery } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { client } from "../api.js";
import { API_BASE, hasApiBase } from "../config.js";
import { Topbar } from "./Topbar.js";
import type { Session } from "./headerState.js";

export function ShellLayout() {
  const { data } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => client.get<Session>("/auth/me"),
    enabled: hasApiBase,
    retry: false,
  });
  const session: Session = data ?? null;
  return (
    <>
      <Topbar apiBase={hasApiBase ? API_BASE : null} session={session} />
      <main className="wrap">
        <Outlet />
      </main>
    </>
  );
}
