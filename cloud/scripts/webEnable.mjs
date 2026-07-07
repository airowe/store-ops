/**
 * Strangler enablement — the PURE decision the Pages `_middleware` makes, plus
 * the combined-`dist/` layout constants. Kept in plain ESM (like stampAssets)
 * so the Node CI runner imports it without a TS loader, and unit-tested from
 * `src/build/webEnable.spec.ts`.
 *
 * Layout of the combined Pages deploy:
 *   dist/                 ← legacy stamped dashboard at the root (app.js, styles.css, …)
 *   dist/assets/*         ← the new TanStack app's hashed bundle (no legacy collision)
 *   dist/{NEW_APP_ENTRY}  ← the new app's index.html (served for owned PAGE routes)
 *   dist/functions/_middleware.js
 *
 * The middleware serves the new app's HTML entry for an owned *navigation* path,
 * and otherwise falls through to static assets (legacy pages, /assets/*, files).
 */

/**
 * The path the middleware sub-requests to serve the new app's shell. The file
 * on disk is `_web.html`, but Cloudflare Pages 308-redirects `*.html` to its
 * extensionless form — so a `next()` to `/_web.html` fails. Request `/_web`
 * (what Pages actually serves the shell at) instead. Preview caught this.
 */
export const NEW_APP_ENTRY = "/_web";

/**
 * Extract the `OWNED_PATHS = [ ... ]` array literal from edgeRoutes.ts source,
 * verbatim, so the generated middleware never forks the map. A naive `\[.*\]`
 * regex breaks on `]` inside RegExp char classes (e.g. `[^/]`), so this scans
 * with bracket-depth + string/regex/comment awareness. Returns the `[...]`
 * literal (valid JS) or null.
 */
export function extractOwnedArray(src) {
  // Anchor on the actual declaration (`OWNED_PATHS` followed by `=`, possibly
  // through a `: Type[]` annotation), NOT a mention in a doc comment above it.
  const decl = src.match(/OWNED_PATHS[^=\n]*=/);
  if (!decl) return null;
  const eq = decl.index + decl[0].length - 1;
  // The first `[` after the `=` is the value literal (the annotation's `[]` is
  // before the `=`).
  const open = src.indexOf("[", eq);
  if (open < 0) return null;

  let depth = 0;
  let i = open;
  let mode = "code"; // code | sstr | dstr | tstr | regex | line | block
  let prevSignificant = ""; // last non-space code char, to disambiguate `/`
  for (; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "line") {
      if (c === "\n") mode = "code";
      continue;
    }
    if (mode === "block") {
      if (c === "*" && n === "/") {
        mode = "code";
        i++;
      }
      continue;
    }
    if (mode === "sstr" || mode === "dstr" || mode === "tstr") {
      if (c === "\\") {
        i++;
        continue;
      }
      if ((mode === "sstr" && c === "'") || (mode === "dstr" && c === '"') || (mode === "tstr" && c === "`"))
        mode = "code";
      continue;
    }
    if (mode === "regex") {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === "[") {
        // char class — consume to the matching ] (where `/` isn't a terminator)
        for (i++; i < src.length && src[i] !== "]"; i++) if (src[i] === "\\") i++;
        continue;
      }
      if (c === "/") mode = "code";
      continue;
    }
    // mode === "code"
    if (c === "'") mode = "sstr";
    else if (c === '"') mode = "dstr";
    else if (c === "`") mode = "tstr";
    else if (c === "/" && n === "/") {
      mode = "line";
      continue; // a comment is like whitespace — must NOT poison prevSignificant
    } else if (c === "/" && n === "*") {
      mode = "block";
      continue;
    } else if (c === "/" && /[[({,=:!&|?+\-*%^~<>]/.test(prevSignificant)) mode = "regex";
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
    if (!/\s/.test(c)) prevSignificant = c;
  }
  return null;
}

/**
 * A request is a NAVIGATION (document) request, not an asset fetch. Only these
 * are candidates for the SPA rewrite; /assets/*, *.js, *.css, files with an
 * extension, and non-GET all fall through to static serving.
 */
export function isNavigationRequest(method, pathname, accept = "") {
  if (method !== "GET" && method !== "HEAD") return false;
  if (pathname.startsWith("/assets/")) return false;
  // A path whose last segment has a file extension is an asset, not a page.
  const last = pathname.split("/").pop() ?? "";
  if (last.includes(".")) return false;
  // Prefer an explicit HTML accept when present; absent header (curl) still
  // counts as navigation for a page-shaped path.
  if (accept && !accept.includes("text/html") && !accept.includes("*/*")) return false;
  return true;
}

/**
 * The middleware decision, pure and dependency-free.
 * @param req {{method:string, pathname:string, accept?:string}}
 * @param resolveSurface (pathname) => "web" | "legacy"
 * @returns {"rewrite-web"|"passthrough"} rewrite-web ⇒ serve NEW_APP_ENTRY;
 *          passthrough ⇒ let Pages serve the static asset (legacy or /assets/*).
 */
export function serveDecision(req, resolveSurface) {
  if (!isNavigationRequest(req.method, req.pathname, req.accept)) return "passthrough";
  return resolveSurface(req.pathname) === "web" ? "rewrite-web" : "passthrough";
}
