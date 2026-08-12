/**
 * Post-deploy smoke test — hits the LIVE deployed surfaces, not the mock.
 *
 * The Playwright `*.e2e.ts` suite drives app.js against mock.js (UI contracts).
 * This is the complement: a thin, READ-ONLY check that the real Worker + D1 +
 * Pages are actually up and behaving after a deploy. It exercises only public,
 * side-effect-free routes — no auth, no writes, no .p8, no store push.
 *
 * Run:  node scripts/smoke.mjs
 *   API_BASE      override the API origin   (default https://api.shipaso.com)
 *   DASHBOARD_URL override the dashboard URL (default https://app.shipaso.com)
 *
 * Exit 0 = all checks passed; exit 1 = at least one failed (prints which).
 * NOT a deploy gate (it runs AFTER deploy — gating on it would be circular);
 * run it post-deploy or on a schedule.
 */

const API = (process.env.API_BASE ?? "https://api.shipaso.com").replace(/\/$/, "");
const DASHBOARD = (process.env.DASHBOARD_URL ?? "https://app.shipaso.com").replace(/\/$/, "");

let failures = 0;
const results = [];

/** Run one named check; record pass/fail without throwing the whole run. */
async function check(name, fn) {
  try {
    await fn();
    results.push(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    results.push(`  ✗ ${name}\n      ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function getJson(path, init) {
  const res = await fetch(API + path, init);
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body — leave null, the check asserts on status */
  }
  return { status: res.status, body };
}

// ── checks ───────────────────────────────────────────────────────────────────

// 1. Worker is live and reports the production env (root is the readiness ping).
await check("GET / → Worker live, env=production", async () => {
  const { status, body } = await getJson("/");
  assert(status === 200, `expected 200, got ${status}`);
  assert(body?.ok === true, `expected {ok:true}, got ${JSON.stringify(body)}`);
  assert(body?.service === "store-ops", `expected service "store-ops", got ${body?.service}`);
  assert(body?.env === "production", `expected env "production", got "${body?.env}"`);
});

// 2. Auth path works and is closed by default (no session ⇒ not authed).
await check("GET /auth/me (no session) → {authed:false}", async () => {
  const { status, body } = await getJson("/auth/me");
  assert(status === 200, `expected 200, got ${status}`);
  assert(body?.authed === false, `expected {authed:false}, got ${JSON.stringify(body)}`);
});

// 3. The real engine + external (iTunes) path works end-to-end — /preview reaches
//    live resolveAppQuery. A well-known app ("calm") must resolve to a real
//    candidate or a full preview, NOT an error. This is the only check that
//    proves the Worker's outbound fetch + engine are healthy on prod.
await check("POST /preview {query:'calm'} → real engine resolves a live app", async () => {
  const { status, body } = await getJson("/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "calm" }),
  });
  assert(status === 200, `expected 200, got ${status} (body: ${JSON.stringify(body)})`);
  // Either a disambiguation page (needsChoice + candidates) or a resolved preview.
  const ok =
    (body?.needsChoice === true && Array.isArray(body?.candidates) && body.candidates.length > 0) ||
    typeof body?.bundleId === "string" ||
    typeof body?.name === "string";
  assert(ok, `expected candidates or a resolved app, got ${JSON.stringify(body).slice(0, 200)}`);
});

// 4. The RLHF export (#39 Part 2) is FAIL-CLOSED in prod: no token ⇒ 403, never
//    a leak of the encrypted dataset. A security regression here would be serious.
await check("GET /admin/preference-data (no token) → 403 fail-closed", async () => {
  const { status } = await getJson("/admin/preference-data");
  assert(status === 403, `expected 403 (fail-closed), got ${status}`);
});

// 5. The dashboard (Pages) is deployed and serves a hashed bundle (the #54
//    freshness/#40 hashing contract: a content-hashed, cache-bustable bundle).
//
//    The pattern is `assets/index-<hash>.js` — vite's output since #356 Phase 3
//    made the app the site. This check spent that whole period asserting the
//    LEGACY stamped name (`app.<hash>.js`), so it was red for a reason that had
//    nothing to do with the dashboard's health. Nobody noticed, because nothing
//    ran it (see the post-deploy step in .github/workflows/deploy.yml).
await check("GET dashboard → 200 with a content-hashed bundle", async () => {
  const res = await fetch(DASHBOARD + "/index.html", { headers: { "cache-control": "no-cache" } });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const html = await res.text();
  assert(
    /assets\/index-[A-Za-z0-9_-]{6,}\.js/.test(html),
    "index.html does not reference a content-hashed assets/index-<hash>.js bundle",
  );
});

// 6. Assets survive a BROWSER-shaped request. `fetch` and a browser do not send
//    the same thing: index.html loads its bundles with `crossorigin`, so a
//    browser attaches an `Origin` header and gets a different cache key.
//
//    On 2026-07-28 that key held a cached HTML error response under
//    `/assets/* → max-age=31536000, immutable`, so every real browser got
//    "Refused to apply style…" and a blank page for hours while every check
//    above stayed green. Checks 1-5 all use plain fetch and would do so again.
//
//    This is the cheap fetch-level guard; prodSmoke.e2e.ts asserts the same
//    thing in an actual browser, which is the only way to catch what a
//    request-shaped check still cannot see.
await check("GET dashboard assets (crossorigin) → correct MIME, not cached HTML", async () => {
  // Read the HTML under the SAME cache key as the assets. `Origin` is part of
  // the key, so fetching index.html without it and the bundles with it reads
  // two different edge states — and during a deploy those diverge: the
  // no-Origin key can serve fresh HTML naming a bundle the Origin-keyed edge
  // has not received yet, and the check 404s on a healthy deployment (#417,
  // which reddened #399). Aligning the reads keeps this a MIME/cached-HTML
  // guard instead of a propagation-timing guard.
  const res = await fetch(DASHBOARD + "/index.html", {
    headers: { "cache-control": "no-cache", Origin: DASHBOARD },
  });
  const html = await res.text();
  const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  assert(refs.length > 0, "index.html referenced no /assets/ bundles");

  for (const path of refs) {
    const asset = await fetch(DASHBOARD + path, { headers: { Origin: DASHBOARD } });
    assert(asset.status === 200, `${path} (with Origin) → ${asset.status}`);
    const type = asset.headers.get("content-type") ?? "";
    const ok = path.endsWith(".css") ? /text\/css/.test(type) : /javascript|ecmascript/.test(type);
    assert(ok, `${path} served as "${type}" to a crossorigin request — cached HTML?`);
  }
});

// ── report ───────────────────────────────────────────────────────────────────

console.log(`\nPost-deploy smoke test`);
console.log(`  API:       ${API}`);
console.log(`  Dashboard: ${DASHBOARD}\n`);
console.log(results.join("\n"));
console.log(
  `\n${failures === 0 ? "✓ all" : `✗ ${failures} of ${results.length}`} smoke checks ${failures === 0 ? "passed" : "FAILED"}.\n`,
);
process.exit(failures === 0 ? 0 : 1);
