/**
 * Decide what the header should render from the auth state — PURE logic.
 *
 * Plain ESM so the Node-20 CI runner imports it without a TS loader (same as the
 * other scripts/*.mjs). app.js mirrors this inline; this is the tested spec.
 *
 * Three modes:
 *   "signedIn"  — live backend + a real session cookie (via:"session"): show the
 *                 real email + Sign out, and the dashboard auto-loads the user's
 *                 apps via GET /apps.
 *   "signIn"    — live backend, logged out (or session still loading, or only a
 *                 demo-stub "session"): show a "Sign in" button → magic link. We
 *                 never show the editable X-User-Email stub on a live backend; it
 *                 can't authenticate on production and is misleading.
 *   "demoStub"  — no API_BASE (local/demo backend): keep the editable "acting
 *                 as…" field, the only way to switch users locally.
 *
 * @typedef {{ authed?: boolean, via?: string, email?: string } | null} Session
 * @typedef {{ mode: "signedIn"|"signIn"|"demoStub", email: string|null }} HeaderState
 *
 * @param {{ hasApiBase: boolean, session: Session }} input
 * @returns {HeaderState}
 */
export function headerState(input) {
  const { hasApiBase, session } = input;
  // No live backend → local/demo: the editable stub is the only switcher.
  if (!hasApiBase) return { mode: "demoStub", email: (session && session.email) || null };
  // Live backend: only a real session cookie counts as signed in.
  if (session && session.authed === true && session.via === "session") {
    return { mode: "signedIn", email: session.email || null };
  }
  // Logged out, loading, or merely a demo-stub session on a live backend.
  return { mode: "signIn", email: null };
}
