/**
 * SPA freshness detection (#54) — PURE logic.
 *
 * Plain ESM (.mjs) on purpose: the unit spec (src/build/freshness.spec.ts)
 * imports THIS file, and app.js mirrors it inline — one tested source of truth
 * that runs under Node 20 with no TS loader (same convention as
 * scripts/stampAssets.mjs and scripts/headerState.mjs).
 *
 * Why it exists: the dashboard is a no-build hash-router SPA. A tab left open
 * across a deploy keeps executing the OLD app.<hash>.js (the browser never
 * re-requests app.js) until a full page load. We detect a newer deploy by
 * re-fetching the always-no-cache /index.html (_headers:13-14) and comparing
 * the app bundle it references against the bundle the browser actually ran
 * (document.currentScript.src). scripts/stampAssets.mjs guarantees a changed
 * bundle gets a NEW filename, so a basename compare is a sound "did it change?".
 *
 * Honesty rule, baked in: on ANY uncertainty (unknown self URL, parse failure,
 * un-hashed dev bundle) we return "not stale" — we never nag on a guess.
 */
/**
 * Extract the referenced app bundle filename (app.<hash>.js, or the bare
 * app.js in local/un-hashed HTML) from an index.html string. Returns null when
 * none is found. The matcher is deliberately scoped to the app.* bundle so
 * config.js / mock.js / styles.css can never be returned. Mirrors the href/src
 * matching shape used by scripts/stampAssets.mjs.
 * @param {string} html
 * @returns {string|null}
 */
export function bundleRefFromHtml(html) {
  if (!html) return null;
  // src="app.js" or src="app.<hex-hash>.js" — the hash is the FNV slug emitted
  // by hashedName() in stampAssets.mjs (>=8 hex chars), made optional so the
  // un-hashed local/public form (bare app.js) still matches.
  var m = String(html).match(/src="(app(?:\.[0-9a-f]+)?\.js)"/);
  return m ? m[1] : null;
}

/**
 * Reduce a URL or path to its bare filename (last path segment), stripping any
 * query/hash. Origin-independent so an absolute self URL and a relative live
 * ref compare cleanly.
 * @param {string} url
 * @returns {string}
 */
function basename(url) {
  if (!url) return "";
  var s = String(url).split("?")[0].split("#")[0];
  var slash = s.lastIndexOf("/");
  return slash >= 0 ? s.slice(slash + 1) : s;
}

/**
 * Given the running script URL (document.currentScript.src) and the bundle
 * filename referenced by the freshly-fetched index.html, decide whether a newer
 * bundle has deployed.
 *
 * Honesty rules (never nag on uncertainty):
 *   - empty selfScriptUrl (currentScript unavailable)  → false
 *   - null liveBundleRef (fetch/parse failed)          → false
 *   - running bundle is bare "app.js" (local/E2E)      → false (dormant in dev)
 *   - basenames equal (no deploy)                      → false
 * Only a known, hashed, DIFFERENT basename is "stale". Compares basenames only,
 * so origin / relative-URL differences never produce a false positive.
 * @param {string} selfScriptUrl
 * @param {string|null} liveBundleRef
 * @returns {boolean}
 */
export function isStale(selfScriptUrl, liveBundleRef) {
  if (!selfScriptUrl || !liveBundleRef) return false;
  var self = basename(selfScriptUrl);
  var live = basename(liveBundleRef);
  if (!self || !live) return false;
  // Un-hashed running bundle → no meaningful version to diff (local/dev/E2E).
  if (self === "app.js") return false;
  return self !== live;
}
