/**
 * The sticky topbar — logo, spacer, theme toggle, env pill, and the auth-aware
 * header area. Pure/presentational: it takes (apiBase, session) and derives what
 * to show via the tested `headerState` + `envPill`, so the whole thing is
 * render-testable without a router or network.
 */
import { envPill } from "./envPill.js";
import { headerState, type Session } from "./headerState.js";
import { ThemeToggle } from "./ThemeToggle.js";

export function Topbar({ apiBase, session }: { apiBase: string | null; session: Session }) {
  const pill = envPill(apiBase);
  const hs = headerState({ hasApiBase: !!apiBase, session });
  return (
    <header className="topbar">
      <div className="topbar-in">
        <div className="logo">
          <span className="tick" aria-hidden="true">✓</span>
          <span>ShipASO <small>autonomous ASO</small></span>
        </div>
        <div className="spacer" />
        <ThemeToggle />
        <div className="who">
          {hs.mode === "demoStub" && <span className="faint">acting as (demo)</span>}
          {hs.mode === "signedIn" && <span data-testid="who-email">{hs.email}</span>}
          {hs.mode === "signIn" && (
            <button type="button" className="btn ghost" data-testid="sign-in">
              Sign in
            </button>
          )}
          <span className={"env-pill " + pill.kind} title={pill.title} data-testid="env-pill">
            {pill.label}
          </span>
        </div>
      </div>
    </header>
  );
}
