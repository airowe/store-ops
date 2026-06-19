// Type declarations for the plain-ESM header-state helper (scripts/headerState.mjs).
// Implementation is .mjs so the Node-20 CI runner imports it without a TS loader.

export type Session = { authed?: boolean; via?: string; email?: string } | null;
export type HeaderState = { mode: "signedIn" | "signIn" | "demoStub"; email: string | null };

export function headerState(input: { hasApiBase: boolean; session: Session }): HeaderState;
