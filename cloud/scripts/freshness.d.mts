// Type declarations for the plain-ESM freshness logic (scripts/freshness.mjs).
// Implementation is .mjs so the Node-20 CI runner imports it without a TS loader
// (same as stampAssets.d.mts / headerState.d.mts); this gives the unit spec types.

export function bundleRefFromHtml(html: string): string | null;
export function isStale(selfScriptUrl: string, liveBundleRef: string | null): boolean;
