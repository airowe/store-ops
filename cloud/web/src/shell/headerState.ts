/**
 * Header state — what the topbar renders from (hasApiBase, session). Ported from
 * the canonical `cloud/scripts/headerState.mjs` (the legacy app.js spec) so the
 * new shell branches on the SAME rule:
 *   • signedIn — live backend + a real session cookie (via:"session")
 *   • signIn   — live backend, logged out / loading / demo-stub session
 *   • demoStub — no API base (local/demo): the editable X-User-Email field
 * The legacy .mjs stays the source for app.js; this mirrors it until the shell
 * logic moves into the shared spine.
 */
export type Session = { authed?: boolean; via?: string; email?: string } | null;
export type HeaderMode = "signedIn" | "signIn" | "demoStub";
export type HeaderState = { mode: HeaderMode; email: string | null };

export function headerState(input: { hasApiBase: boolean; session: Session }): HeaderState {
  const { hasApiBase, session } = input;
  if (!hasApiBase) return { mode: "demoStub", email: (session && session.email) || null };
  if (session && session.authed === true && session.via === "session") {
    return { mode: "signedIn", email: session.email || null };
  }
  return { mode: "signIn", email: null };
}
