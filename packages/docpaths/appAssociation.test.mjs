import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * The iOS app's associated domain must actually serve the association file.
 *
 * App Review rejected 0.1.0 under Guideline 2.1(a) — "The sign in link does not
 * link user back to the app" (submission a64749cd, 2026-07-29). The cause was
 * not the app: the binary declared `applinks:shipaso.com`, and that host
 * returned 404 for /.well-known/apple-app-site-association. The file existed
 * only on app.shipaso.com. iOS therefore had no association to read, the magic
 * link opened Safari, and it stayed there.
 *
 * Nothing caught it because each half was individually correct — a valid AASA
 * file, and a valid entitlement, pointing at different hosts. That is exactly
 * the failure a cross-check exists for.
 *
 * Static assertions only: this reads the entitlement out of app.config.ts and
 * the deployed site out of the repo. It cannot prove the deployed host serves
 * the file (only a live fetch can, which is what smoke does), but it does prove
 * the two halves AGREE — the thing that was wrong.
 */
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

/** The host the shipped binary tells iOS to fetch the association from. */
function associatedHost() {
  const cfg = read("mobile/app.config.ts");
  const m = cfg.match(/ASSOCIATED_HOST\s*=\s*["'`]([^"'`]+)["'`]/);
  assert.ok(m, "mobile/app.config.ts must define ASSOCIATED_HOST");
  return m[1];
}

/**
 * Which Pages project serves a given host. Hand-maintained because the mapping
 * lives in Cloudflare, not the repo — but pinned here so a host change forces
 * a deliberate update rather than silently pointing at a site that lacks the file.
 */
const SITE_ROOT_FOR_HOST = {
  "shipaso.com": "docs/landing",
  "app.shipaso.com": "cloud/web/public",
};

test("the associated host's site actually ships apple-app-site-association", () => {
  const host = associatedHost();
  const root = SITE_ROOT_FOR_HOST[host];
  assert.ok(
    root,
    `ASSOCIATED_HOST is "${host}" but no site root is mapped for it — add it to SITE_ROOT_FOR_HOST (and make sure that site serves /.well-known/apple-app-site-association)`,
  );
  assert.ok(
    existsSync(join(repoRoot, root, ".well-known/apple-app-site-association")),
    `the app declares applinks:${host}, but ${root} ships no .well-known/apple-app-site-association — iOS will have no association to read and universal links will open in Safari instead of the app`,
  );
});

test("the association file names the shipped bundle id", () => {
  const host = associatedHost();
  const root = SITE_ROOT_FOR_HOST[host];
  const aasa = JSON.parse(read(join(root, ".well-known/apple-app-site-association")));
  const bundleId = read("mobile/app.config.ts").match(
    /APP_IDENTIFIER\s*=\s*["'`]([^"'`]+)["'`]/,
  )?.[1];
  assert.ok(bundleId, "mobile/app.config.ts must define APP_IDENTIFIER");

  const appIDs = (aasa.applinks?.details ?? []).flatMap((d) => d.appIDs ?? []);
  assert.ok(
    appIDs.some((id) => id.endsWith(`.${bundleId}`)),
    `apple-app-site-association lists ${JSON.stringify(appIDs)}, none of which is the shipped bundle id "${bundleId}" — the association would be for a different app`,
  );
});

/**
 * Pages serves an extensionless file as application/octet-stream by default,
 * and iOS refuses to parse that. The Content-Type override is the only reason
 * the file works, so it is as load-bearing as the file itself.
 */
test("the site pins application/json for the extensionless association file", () => {
  const host = associatedHost();
  const root = SITE_ROOT_FOR_HOST[host];
  const headers = read(join(root, "_headers"));
  const block = headers.match(
    /^\/\.well-known\/apple-app-site-association\s*\n((?:\s{2}.*\n)+)/m,
  );
  assert.ok(
    block,
    `${root}/_headers has no rule for /.well-known/apple-app-site-association — Pages will serve it as application/octet-stream and iOS will reject it`,
  );
  assert.match(
    block[1],
    /Content-Type:\s*application\/json/i,
    "the association file must be served as application/json",
  );
});

/**
 * The link the email actually contains has to be on the associated host.
 *
 * This is the fault that caused the rejection. MAGIC_LINK_BASE was UNSET, so
 * buildMagicLink() fell back to `${requestOrigin}/auth/callback` — api.shipaso.com,
 * which iOS was never told to associate. The link opened Safari and stayed
 * there. Declaring it in [vars] rather than as a `wrangler secret` is what makes
 * it deploy automatically instead of being a step someone must remember.
 */
test("MAGIC_LINK_BASE is set, and points at the app's associated host", () => {
  const toml = read("cloud/wrangler.toml");
  const m = toml.match(/^MAGIC_LINK_BASE\s*=\s*"([^"]+)"/m);
  assert.ok(
    m,
    "cloud/wrangler.toml does not set MAGIC_LINK_BASE — magic links fall back to the API origin, which is not an associated domain, and sign-in will not return to the app",
  );
  const host = new URL(m[1]).host;
  assert.equal(
    host,
    associatedHost(),
    `MAGIC_LINK_BASE points at "${host}" but the app declares applinks:${associatedHost()} — a link on a non-associated host opens Safari instead of the app`,
  );
});

/**
 * The magic link's landing path. MAGIC_LINK_BASE points at the associated host,
 * and the AASA maps /auth/m — so that path has to exist on that site or the
 * link 404s before iOS ever gets a chance to hand off.
 */
test("the associated host serves the /auth/m path the association maps", () => {
  const host = associatedHost();
  const root = SITE_ROOT_FOR_HOST[host];
  const aasa = JSON.parse(read(join(root, ".well-known/apple-app-site-association")));
  const paths = (aasa.applinks?.details ?? [])
    .flatMap((d) => d.components ?? [])
    .map((c) => c["/"])
    .filter((p) => typeof p === "string" && !p.includes("*"));

  for (const p of paths) {
    const asIndex = join(root, p.replace(/^\//, ""), "index.html");
    assert.ok(
      existsSync(join(repoRoot, asIndex)),
      `the association maps ${p} on ${host}, but ${asIndex} does not exist — the magic link would 404 before iOS could hand off to the app`,
    );
  }
});
