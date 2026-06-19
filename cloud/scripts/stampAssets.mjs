/**
 * Content-hash cache-busting for the static Pages dashboard — PURE logic.
 *
 * Plain ESM (.mjs) on purpose: the CI runner is on Node 20, which cannot import
 * a .ts module (that mismatch broke the first deploy — ERR_UNKNOWN_FILE_EXTENSION).
 * Both the build script (stamp-assets.mjs) and the unit spec
 * (src/build/stampAssets.spec.ts) import THIS file, so there is one source of
 * truth that runs everywhere without a TS loader.
 *
 * Why it exists: public/ ships un-hashed filenames (app.js, …) with no build
 * step, so a returning browser keeps the previous bundle after a deploy until a
 * manual hard refresh. That stale bundle is what made a "Mangia" preview audit
 * the WRONG app (#40). Hashing each asset to name.<hash>.ext + rewriting the
 * HTML references makes every deploy invalidate the client bundle.
 *
 * @typedef {{ name: string, body: Uint8Array }} AssetFile
 * @typedef {{ html: string, assets: AssetFile[] }} StampResult
 */

/**
 * A short, deterministic content hash (FNV-1a, 64-bit, hex). Not cryptographic
 * — cache-busting only needs "different bytes → different slug". Synchronous and
 * dependency-free; unchanged assets keep a stable slug across deploys.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function contentHash(bytes) {
  const PRIME_LO = 0x01000193;
  let hi = 0xcbf2_9ce4 >>> 0;
  let lo = 0x84222325 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    lo ^= bytes[i];
    const loXprime = lo * PRIME_LO;
    const hiXprime = hi * PRIME_LO + Math.floor(loXprime / 0x1_0000_0000);
    lo = loXprime >>> 0;
    hi = (hiXprime ^ (lo >>> 24)) >>> 0;
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(hi) + hex(lo);
}

/** @param {string} name */
function splitName(name) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
}

/**
 * @param {string} name
 * @param {Uint8Array} bytes
 */
function hashedName(name, bytes) {
  const { stem, ext } = splitName(name);
  const h = contentHash(bytes);
  return ext ? `${stem}.${h}.${ext}` : `${stem}.${h}`;
}

/**
 * Stamp the assets referenced by `html`. Only assets whose bare filename appears
 * as a local href/src are hashed + emitted; data: URIs and remote references are
 * untouched.
 * @param {string} html
 * @param {AssetFile[]} assets
 * @returns {StampResult}
 */
export function stampAssets(html, assets) {
  let out = html;
  /** @type {AssetFile[]} */
  const stamped = [];

  for (const file of assets) {
    const escaped = file.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ref = new RegExp(`((?:href|src)=")(${escaped})(")`, "g");
    if (!ref.test(out)) continue;
    const newName = hashedName(file.name, file.body);
    out = out.replace(
      new RegExp(`((?:href|src)=")(${escaped})(")`, "g"),
      `$1${newName}$3`,
    );
    stamped.push({ name: newName, body: file.body });
  }

  return { html: out, assets: stamped };
}
