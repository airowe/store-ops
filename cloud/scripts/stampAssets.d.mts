// Type declarations for the plain-ESM stamping logic (scripts/stampAssets.mjs).
// The implementation is .mjs so the Node-20 CI runner can import it without a TS
// loader; this .d.ts gives the build script + unit spec real types.

export type AssetFile = { name: string; body: Uint8Array };
export type StampResult = { html: string; assets: AssetFile[] };

export function contentHash(bytes: Uint8Array): string;
export function stampAssets(html: string, assets: AssetFile[]): StampResult;
