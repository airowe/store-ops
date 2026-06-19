/**
 * Content-hash cache-busting for the static Pages dashboard.
 *
 * `public/` ships un-hashed filenames (app.js, mock.js, config.js, styles.css)
 * with NO build step, so a returning browser keeps the previous bundle after a
 * deploy until a manual hard-refresh. That stale bundle is exactly what made a
 * "Mangia" preview audit the wrong app (the old app.js auto-resolved instead of
 * showing the picker the current server returns) — see #40.
 *
 * The fix: at deploy time, hash each asset's bytes, rename it to
 * `name.<hash>.ext`, and rewrite the HTML references. The HTML itself is served
 * with no-cache by Pages, so it always points at the current hashes; the hashed
 * assets can be cached forever. A changed asset → new hash → new URL → fetched.
 *
 * This module is PURE (bytes in, bytes out) so it unit-tests without a build or
 * filesystem; `scripts/stamp-assets.mjs` is the thin fs wrapper that reads
 * `public/`, calls `stampAssets`, and writes the stamped `dist/`.
 */

/** A single static asset: its (un-hashed) filename and raw bytes. */
export type AssetFile = { name: string; body: Uint8Array };

export type StampResult = {
  /** The rewritten index.html, referencing the hashed asset names. */
  html: string;
  /** The stamped assets (renamed to name.<hash>.ext), bytes unchanged. */
  assets: AssetFile[];
};

/**
 * A short, deterministic content hash (FNV-1a, 64-bit, hex). Not cryptographic
 * — cache-busting only needs "different bytes → different slug", and FNV is
 * dependency-free and synchronous (Web Crypto's digest is async). Two distinct
 * deploys of the same file produce the same slug, so unchanged assets stay
 * cached across deploys.
 */
export function contentHash(bytes: Uint8Array): string {
  // 64-bit FNV-1a via two 32-bit lanes to stay in safe-integer range.
  const PRIME_LO = 0x01000193;
  let hi = 0xcbf2_9ce4 >>> 0;
  let lo = 0x84222325 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    lo ^= bytes[i]!;
    // multiply the 64-bit value by the FNV prime (0x100000001b3), folding the
    // low 32 bits' prime into both lanes — sufficient mixing for a cache key.
    const loXprime = lo * PRIME_LO;
    const hiXprime = hi * PRIME_LO + Math.floor(loXprime / 0x1_0000_0000);
    lo = loXprime >>> 0;
    hi = (hiXprime ^ (lo >>> 24)) >>> 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(hi) + hex(lo);
}

/** Split "app.js" → { stem: "app", ext: "js" }; "styles.css" → "styles"/"css". */
function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
}

function hashedName(name: string, bytes: Uint8Array): string {
  const { stem, ext } = splitName(name);
  const h = contentHash(bytes);
  return ext ? `${stem}.${h}.${ext}` : `${stem}.${h}`;
}

/**
 * Stamp the assets referenced by `html`. Only assets whose bare filename appears
 * as a local `href`/`src` in the HTML are hashed + emitted; data: URIs and
 * remote (http/https/protocol-relative) references are left untouched. Returns
 * the rewritten HTML plus the stamped (renamed) assets.
 */
export function stampAssets(html: string, assets: AssetFile[]): StampResult {
  let out = html;
  const stamped: AssetFile[] = [];

  for (const file of assets) {
    // Match the bare name only inside a local href/src attribute, so we never
    // rewrite a data: or https:// reference that happens to contain the stem.
    const escaped = file.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ref = new RegExp(`((?:href|src)=")(${escaped})(")`, "g");
    if (!ref.test(out)) continue; // not referenced → don't stamp/emit it
    const newName = hashedName(file.name, file.body);
    out = out.replace(
      new RegExp(`((?:href|src)=")(${escaped})(")`, "g"),
      `$1${newName}$3`,
    );
    stamped.push({ name: newName, body: file.body });
  }

  return { html: out, assets: stamped };
}
