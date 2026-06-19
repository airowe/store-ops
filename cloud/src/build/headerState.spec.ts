import { describe, it, expect } from "vitest";
import { headerState } from "../../scripts/headerState.mjs";

/**
 * The header used to always show an editable "acting as <email>" stub that sends
 * an X-User-Email header. On production (APP_ENV=production) that header is
 * rejected (401) and the field is misleading — it implies a session when the
 * user is logged out. This pure helper decides what the header should render
 * from (hasApiBase, session), so app.js can branch without re-deriving the rule.
 *
 *   "signedIn"  → real email + Sign out; apps auto-load (live + a real session)
 *   "signIn"    → a "Sign in" button (live backend, logged out) → magic link
 *   "demoStub"  → the editable X-User-Email field (no API_BASE → local/demo only)
 */

describe("headerState", () => {
  it("live backend + real session → signedIn (show email, auto-load apps)", () => {
    const s = headerState({ hasApiBase: true, session: { authed: true, via: "session", email: "me@x.com" } });
    expect(s.mode).toBe("signedIn");
    expect(s.email).toBe("me@x.com");
  });

  it("live backend + logged out → signIn button (NOT the stub)", () => {
    const s = headerState({ hasApiBase: true, session: { authed: false } });
    expect(s.mode).toBe("signIn");
  });

  it("live backend + session still loading (null) → signIn (never flash the stub)", () => {
    const s = headerState({ hasApiBase: true, session: null });
    expect(s.mode).toBe("signIn");
  });

  it("no API_BASE (local/demo) → demoStub (keep the editable field)", () => {
    const s = headerState({ hasApiBase: false, session: { authed: true, via: "demo", email: "demo@store-ops.dev" } });
    expect(s.mode).toBe("demoStub");
  });

  it("a demo-via session on a live backend is NOT treated as signedIn", () => {
    // via:"demo" means the X-User-Email stub path — on a live (prod) backend that
    // can't really authenticate, so we must not show it as a real signed-in user.
    const s = headerState({ hasApiBase: true, session: { authed: true, via: "demo", email: "x@y.com" } });
    expect(s.mode).toBe("signIn");
  });

  it("signedIn requires via === 'session' specifically", () => {
    const ok = headerState({ hasApiBase: true, session: { authed: true, via: "session", email: "a@b.com" } });
    const notOk = headerState({ hasApiBase: true, session: { authed: true, via: "magic", email: "a@b.com" } as any });
    expect(ok.mode).toBe("signedIn");
    expect(notOk.mode).toBe("signIn"); // unknown via on live → not a trusted session
  });
});
