import { describe, it, expect } from "vitest";
import { headerState } from "./headerState.js";

// Mirrors cloud/src/build/headerState.spec.ts against the ported TS copy.
describe("headerState (ported spec)", () => {
  it("live + real session cookie → signedIn", () => {
    const s = headerState({ hasApiBase: true, session: { authed: true, via: "session", email: "me@x.com" } });
    expect(s).toEqual({ mode: "signedIn", email: "me@x.com" });
  });
  it("live + logged out → signIn (never the stub)", () => {
    expect(headerState({ hasApiBase: true, session: { authed: false } }).mode).toBe("signIn");
  });
  it("live + loading (null session) → signIn", () => {
    expect(headerState({ hasApiBase: true, session: null }).mode).toBe("signIn");
  });
  it("no API base → demoStub keeps the editable field", () => {
    expect(headerState({ hasApiBase: false, session: { email: "demo@x.dev" } }).mode).toBe("demoStub");
  });
  it("a demo-via session on a live backend is NOT signedIn", () => {
    expect(headerState({ hasApiBase: true, session: { authed: true, via: "demo", email: "x@y.com" } }).mode).toBe("signIn");
  });
});
