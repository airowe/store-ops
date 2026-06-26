# PRD — SPA freshness: nudge returning users to reload when a new `app.js` is deployed

**Issue:** #54
**Status:** Proposed (post-launch polish; needs one small product DECISION — see §8)
**Author:** Senior product engineer, ShipASO
**Effort:** **S** (small)

---

## 1. Problem & context

### What's happening
The ShipASO dashboard is a no-build, no-framework single-page app. `cloud/public/index.html:37-40` loads exactly three scripts in order:

```html
<script src="config.js"></script>   <!-- index.html:38 -->
<script src="mock.js"></script>      <!-- index.html:39 -->
<script src="app.js"></script>       <!-- index.html:40 -->
```

`app.js` is a hash router (`window.addEventListener("hashchange", route)` at `cloud/public/app.js:2561`, boot at `app.js:2562`). Every in-app navigation — `#/apps/:id`, `#/runs/:id`, the dashboard — is handled by `route()` (`app.js:2548-2559`) re-rendering `#view` **in place**. The browser never re-requests `app.js`. So a tab left open across a deploy keeps executing the **old bundle** until a full page load.

### Why the hashed filenames don't close this gap
The #40 cache-busting work (`scripts/stamp-assets.mjs` + the pure `scripts/stampAssets.mjs`) content-hashes assets to `app.<hash>.js` and rewrites `index.html` to reference them, emitting a deploy-ready `dist/`. The `_headers` policy makes this correct **on reload**:

```
/index.html  → Cache-Control: no-cache       (always revalidated)   (_headers:13-14)
/*.js        → Cache-Control: ...immutable    (cache forever)        (_headers:17-18)
```

So a reload always pulls a fresh `index.html`, which references the newest `app.<hash>.js`. The hashing is correct. The gap is purely **"the returning user never reloads."**

### Observed concretely (from #54)
A long-lived authenticated tab kept running the #49-era `app.fa044e53….js` after the #47/#48 deploy shipped `app.919d95b3….js`. The #47 screenshot gallery looked *absent* — but the data and code were correct; the tab simply hadn't loaded the new bundle. A single fresh `index.html` load fixed it instantly.

### Why it matters
- **Silent feature/fix starvation.** Returning users miss shipped features and bug fixes (and, worse, may hit *removed* API shapes) with zero signal that a refresh would fix it.
- **False "it's broken" signals.** A missing gallery / panel reads as a product bug during live verification, costing debugging time chasing a non-bug.
- **Honesty alignment.** ShipASO's core value is honesty about state. A stale client can render an outdated view of a user's run; nudging a refresh keeps what the user sees aligned with what we actually shipped. (This is a *freshness* nicety, **not** a data-integrity fix — see §6.)

---

## 2. Goal & non-goals

### Goal
Detect when a newer client bundle has been deployed while a tab is open, and show a **gentle, dismissible, non-blocking** banner: *"A new version of ShipASO is available — refresh to update,"* with a **Refresh** button that calls `location.reload()`. Detection runs cheaply (window focus + a long interval), requires **no backend change**, and **never auto-reloads**.

### Success criteria
- A tab open across a deploy surfaces the banner within one focus event (or one poll interval) of the deploy.
- The banner is dismissible and never steals focus, blocks the view, or interrupts an in-progress action (drafting/approving a proposal, entering ASC credentials).
- Zero false positives in steady state (no deploy → no banner, ever).
- No new backend route, no new D1 table, no change to the Worker.
- Detection is silent on any failure (offline, mock mode, fetch error) — it must never toast an error or fall the app into mock mode.

### Non-goals
- **No auto-reload.** Never reload mid-action; the user owns the moment of refresh (protects unsaved proposal/approval/credential state). See §6.
- **No service worker / PWA / background sync.** Out of scope; far heavier than warranted.
- **No new backend endpoint** in v1. We compare against the already-no-cache `/index.html`. (A `/version.json` alternative is noted in §3 but explicitly deferred.)
- **No forced upgrade / hard version gating.** This is a nudge, not a kill-switch for old clients.
- **No behavior in local/mock/dev mode.** When there's no real Pages-served `index.html` to diff against (local `python3 -m http.server`, E2E), detection stays inert.

---

## 3. Proposed approach (grounded in real files)

### 3.1 Core idea
On load, record the **currently-running bundle's hashed filename** (the `app.<hash>.js` the browser actually executed). Periodically and on window focus, fetch the live, always-revalidated `/index.html`, extract its referenced `app.<hash>.js`, and compare. If the live HTML references a **different** `app.<hash>.js`, a new bundle has deployed → show the banner.

This leans directly on two existing guarantees:
- `_headers:13-14` already serves `/index.html` `no-cache`, so a re-fetch always sees the latest deployed HTML — **no backend change needed.**
- `scripts/stampAssets.mjs` guarantees a changed bundle gets a **new filename** (`hashedName()` at `stampAssets.mjs:53-57`), so a string compare of the referenced `app.*.js` name is a sound "did it change?" test.

### 3.2 Capturing the running bundle's identity
The running script's own URL is the source of truth. Because `app.js` is a classic (non-module) IIFE script (`index.html:40`, `app.js:16`), it can read `document.currentScript.src` at top-level execution time. In the deployed `dist/`, that resolves to `…/app.<hash>.js`; in local/E2E (`public/`, un-hashed) it resolves to `…/app.js`.

We capture this once at module init (top of the `app.js` IIFE, near the `CFG`/`API_BASE` setup at `app.js:19-20`):

```js
// The bundle the browser actually executed. In dist/ this is app.<hash>.js
// (content-hashed by scripts/stampAssets.mjs); in local/public it's app.js.
var SELF_SCRIPT = (document.currentScript && document.currentScript.src) || "";
```

### 3.3 Pure, testable comparison logic (new file)
Following the established repo pattern — pure logic in `scripts/*.mjs`, unit-tested via `src/build/*.spec.ts`, mirrored inline in `app.js` (exactly how `headerState.mjs` / `stampAssets.mjs` are structured) — add **`cloud/scripts/freshness.mjs`** exporting two pure functions:

```js
/**
 * Extract the referenced app bundle filename (app.<hash>.js, or bare app.js)
 * from an index.html string. Returns null if none is found.
 * Mirrors the href/src matching shape used by stampAssets.mjs.
 */
export function bundleRefFromHtml(html) { /* regex: src="(app(?:\.[0-9a-f]+)?\.js)" */ }

/**
 * Given the running script URL (document.currentScript.src) and the bundle
 * filename referenced by the freshly-fetched index.html, decide whether a
 * newer bundle has deployed. Returns false when either side is unknown
 * (honest "don't know" → never nag), or when the names match.
 */
export function isStale(selfScriptUrl, liveBundleRef) { /* compare basenames */ }
```

Design rules baked into `isStale`:
- **Unknown ⇒ not stale.** If `selfScriptUrl` is empty (some browsers, or `currentScript` unavailable) or `liveBundleRef` is null (fetch/parse failed), return `false`. We never nag on uncertainty — consistent with the product's honesty posture.
- **Local/un-hashed ⇒ not stale.** If the running script basename is exactly `app.js` (the un-hashed local/E2E case), return `false` (there's no meaningful version to diff). This keeps the feature dormant in dev and in Playwright runs unless a test explicitly drives it.
- Compare **basenames only** (`app.<hash>.js`), origin-independent, to avoid `http://`/relative-URL mismatches.

### 3.4 The checker + banner (inline in `app.js`)
A small controller, added in the `app.js` IIFE and wired in the boot handler (`app.js:2562-2593`):

- **`checkFreshness()`** — `fetch("/index.html", { cache: "no-store" })` (root-relative so it hits the Pages origin, honoring `_headers`), read text, `bundleRefFromHtml(...)`, then `isStale(SELF_SCRIPT, ref)`. On any throw/offline → silently return (no toast, **no `liveMode` flip**; this fetch is deliberately separate from `api()` at `app.js:69` so a freshness-probe failure can't knock the app into mock mode). If stale and not already shown → `showFreshnessBanner()`.
- **Triggers:**
  - `window.addEventListener("focus", checkFreshness)` — the cheapest, highest-signal trigger (user returns to the tab).
  - `setInterval(checkFreshness, FRESHNESS_POLL_MS)` with `FRESHNESS_POLL_MS = 15 * 60 * 1000` (15 min) as a backstop for an always-foreground tab.
  - **Not** on every `route()` — focus + interval already cover it without adding a network hop to every hash navigation (DECISION in §8 if the owner wants route-change too).
- **Guard:** a `freshnessBannerShown` boolean so we fetch/diff at most once into the "shown" state; once shown we stop polling (the state can only go stale→stale).
- **Only when live:** gate the whole thing on `API_BASE` being set (`app.js:20`) **and** the running bundle being hashed (not bare `app.js`), so it's inert in local/demo/E2E by default.

**Banner UI:** a dismissible bar reusing the existing visual language (the `.toast` token family at `styles.css:594-601`, restyled as a top, persistent, dismissible `.freshness-banner`). It contains the copy, a **Refresh** button (`onclick: function(){ location.reload(); }`), and a **Dismiss** (×) button. Non-blocking: `pointer-events` only on the bar itself, fixed position, above content but it does not cover `#view`. Dismiss hides it for the session (we don't re-nag the same detected version; a *further* deploy can show it again).

### 3.5 Deferred alternative (documented, not built)
A tiny `/version.json` (or a `<meta name="build" content="<hash>">` injected by `stamp-assets.mjs`) would be a smaller fetch than full `index.html`. It's deferred because (a) `index.html` is already `no-cache` and tiny (~2.2 KB, `cloud/public/index.html`), and (b) it needs zero build/Worker change. If the HTML grows or we want an explicit build id, revisit — `stamp-assets.mjs:68` (the `writeFileSync(... stampedHtml)` step) is the natural injection point for a `<meta>` build stamp.

---

## 4. Exact files to change + new files

### New files
| File | Purpose |
|---|---|
| `cloud/scripts/freshness.mjs` | **Pure logic:** `bundleRefFromHtml(html)` + `isStale(selfScriptUrl, liveBundleRef)`. Plain ESM (Node-20-importable, no TS loader) — same rationale as `stampAssets.mjs:1-8`. |
| `cloud/scripts/freshness.d.mts` | TS typings for the spec to import (mirrors `scripts/stampAssets.d.mts`, `scripts/headerState.d.mts`). |
| `cloud/src/build/freshness.spec.ts` | **Unit spec** importing `../../scripts/freshness.mjs` (mirrors `src/build/stampAssets.spec.ts:6`). |
| `cloud/tests/e2e/freshness.e2e.ts` | **E2E** driving the real `app.js` + `index.html` against an intercepted/mutated HTML to assert the banner appears, refreshes, and dismisses. |

### Changed files
| File | Change |
|---|---|
| `cloud/public/app.js` | (1) Capture `SELF_SCRIPT` from `document.currentScript.src` at IIFE init (near `app.js:19`). (2) Add inline mirror of `bundleRefFromHtml`/`isStale` (keep in sync with `scripts/freshness.mjs`, same convention as the `headerState`/`searchController` mirrors). (3) Add `checkFreshness()`, `showFreshnessBanner()`, `dismissFreshnessBanner()`. (4) Wire `focus` listener + `setInterval`, gated on `API_BASE` + hashed bundle, inside the boot handler (`app.js:2562-2593`). |
| `cloud/public/styles.css` | Add `.freshness-banner` (+ `.show`, button styles), reusing existing CSS tokens (`var(--panel)`, `var(--line)`, `var(--shadow)`, `var(--accent)`), modeled on `.toast` at `styles.css:594-601`. |
| `cloud/public/index.html` | Add the banner container element, e.g. `<div class="freshness-banner" id="freshness" role="status" aria-live="polite"></div>`, near the existing `<div class="toast" id="toast"></div>` at `index.html:35`. |

### Explicitly NOT changed
- `cloud/src/api/index.ts` and any Worker code — **no backend route added** (v1 compares against the already-no-cache `/index.html`).
- `cloud/_headers` — current policy (`/index.html` no-cache) is exactly what this relies on; leave as-is.
- `cloud/scripts/stamp-assets.mjs` / `stampAssets.mjs` — unchanged in v1 (only touched if we later choose the `<meta>` build-stamp variant).

---

## 5. Test plan (TDD; repo conventions)

Follow the repo's TDD flow (stub → failing test → implement) and file conventions: pure unit specs as `*.spec.ts` under `src/build/` (vitest, `node` env, glob `src/**/*.spec.ts` per `vitest.config.ts`), E2E as `*.e2e.ts` under `tests/e2e/` (Playwright, glob in `playwright.config.ts`). Parameterize inputs; strong assertions.

### 5.1 Unit — `cloud/src/build/freshness.spec.ts`
Imports `bundleRefFromHtml`, `isStale` from `../../scripts/freshness.mjs` (mirrors `stampAssets.spec.ts:6`).

`describe("bundleRefFromHtml")`:
- extracts `app.919d95b3.js` from realistic stamped HTML (use the same 3-script shape as `index.html:38-40`).
- extracts bare `app.js` from un-hashed (local/`public/`) HTML.
- returns `null` when no app script is referenced.
- ignores `config.js` / `mock.js` / `styles.css` (only matches the `app.*` bundle).

`describe("isStale")`:
- `true` when running `app.<oldHash>.js` and live HTML references `app.<newHash>.js`.
- `false` when both reference the same hashed name (no deploy).
- `false` when `selfScriptUrl` is empty (unknown self → never nag).
- `false` when `liveBundleRef` is `null` (fetch/parse failed → never nag).
- `false` when the running bundle is bare `app.js` (local/E2E case → dormant).
- origin/relative independence: `https://app.shipaso.com/app.AAA.js` vs live ref `app.BBB.js` ⇒ `true` (compares basenames).
- parameterize the hash pairs (no unexplained literals — use named `OLD`/`NEW` hash constants).

### 5.2 E2E — `cloud/tests/e2e/freshness.e2e.ts`
Drives the real `app.js`/`index.html` via Playwright, mock backend (reuse `gotoMockDashboard` from `tests/e2e/helpers.ts:10`). Because local `public/` is un-hashed, simulate the deploy with route interception:

- **Banner appears on a new deploy:** stub the running bundle as hashed (inject `SELF_SCRIPT` as `app.OLD.js` via `addInitScript`, or expose a test seam), intercept the `/index.html` re-fetch to return HTML referencing `app.NEW.js`, fire `window.dispatchEvent(new Event("focus"))`, assert `#freshness` becomes visible with the expected copy + a Refresh button.
- **Refresh reloads:** click Refresh, assert `page.reload`-equivalent navigation occurred (assert via a `page.on("framenavigated")` / load counter).
- **Dismiss hides + doesn't re-nag the same version:** click ×, assert `#freshness` hidden; fire `focus` again with the *same* `app.NEW.js` HTML, assert it stays hidden.
- **No false positive:** intercept `/index.html` to return HTML referencing the **same** running bundle, fire `focus`, assert `#freshness` never shows.
- **Inert in mock/local default:** with the default un-hashed `app.js` (no `SELF_SCRIPT` injection), fire `focus`, assert `#freshness` never shows — proving the feature is dormant in dev/E2E unless explicitly driven.
- **Silent on fetch failure:** intercept `/index.html` to abort, fire `focus`, assert no toast appears and the app is **not** flipped to mock mode (assert the env pill / `liveMode` unaffected — the freshness probe must be isolated from `api()` at `app.js:69`).

### 5.3 Gates
Run `npm run typecheck`, `npm test` (vitest), and `npm run test:e2e` (Playwright) before any commit. Per repo + user standards, **do not commit without the owner's explicit approval**, and the agent **never auto-pushes**.

---

## 6. Honesty & security considerations

- **No data is fabricated or presented as measured.** This feature only compares two **client asset filenames** (the running `app.<hash>.js` vs the one `/index.html` references). It reads, persists, and transmits **zero** rank/app/user data. It cannot present unseen data as measured because it touches no measurement surface.
- **Never auto-reload.** Auto-reloading mid-action could silently discard an in-progress proposal edit, an approval-in-flight, or — critically — **ephemeral ASC `.p8` credentials held only in JS memory** (`ascCredsMemory` at `app.js:67`, deliberately never persisted). The banner is **advisory only**; the human chooses when to reload. This preserves the standing "never persist the `.p8`" rule (a reload at the wrong moment doesn't leak it, but it *would* drop the user's same-run convenience and could mid-flight an approval). The non-blocking, dismissible design is a direct honesty/safety requirement, not cosmetic.
- **The agent never auto-pushes.** Unchanged. This feature is client-only freshness UX and has no interaction with the approval gate or push-command handoff (`runView`/`serializeRunResult`, `src/api/index.ts:219-285`), which still withhold `pushCommands` until a human approves.
- **No credential surface, no new endpoint, no new auth.** v1 adds no Worker route; it fetches the same public, already-no-cache `/index.html` the browser loads anyway. No cookies, no `X-User-Email`, no CORS surface added.
- **Fail safe + fail honest.** On any uncertainty (unknown self URL, failed/parsed-empty fetch, offline) the logic returns "not stale" and shows nothing. We never nag on a guess, and a freshness-probe failure must not toast an error or flip the app into mock mode (the probe is isolated from `api()`).
- **No fingerprinting / tracking.** No identifiers stored; the only state is a session-scoped "banner shown for version X" flag.

---

## 7. Risks & rollout

| Risk | Likelihood | Mitigation |
|---|---|---|
| False-positive banner (nags with no real deploy) | Low | `isStale` returns false on any unknown/parse-failure; basename compare is exact; unit + E2E "no false positive" cases. |
| `document.currentScript.src` unavailable/empty in some context | Low | `isStale` treats empty self URL as "not stale" → silently inert (no nag), never a crash. |
| Freshness `fetch` failure knocks app into mock mode | Med if naively reusing `api()` | Use a **dedicated** `fetch("/index.html", {cache:"no-store"})`, fully isolated from `api()`/`liveMode` (`app.js:69-101`); swallow errors. |
| Banner interrupts an action (ASC creds, approval) | Med | Non-blocking, dismissible, top bar that never covers `#view`; never auto-reloads (§6). |
| Extra polling cost | Negligible | Focus-driven + 15-min interval; stops polling once shown; one ~2 KB `no-cache` fetch. |
| Behaves in local/E2E unexpectedly | Low | Gated on `API_BASE` set **and** hashed bundle; bare `app.js` ⇒ dormant; covered by the "inert in mock/local" E2E. |

**Rollout:** Pure additive, client-only, no backend or schema change → ships with the next Pages deploy (`npm run deploy:dashboard` → `build:dashboard` + `wrangler pages deploy dist`, per `package.json`). No migration, no feature flag needed; the gating on `API_BASE` + hashed bundle is the natural "prod-only" switch. Easy revert: remove the banner element + the `app.js` wiring (no persisted state to clean up). Verify live by deploying twice and confirming an open tab surfaces the banner on focus after the second deploy.

---

## 8. Effort estimate & decision needed

**Effort: S (small).** ~1 small pure module + spec, ~40-60 lines of inline `app.js` wiring, a banner element + ~15 lines of CSS, and one E2E file. No backend, no schema, no new deps. Bulk of the work is the E2E harness to simulate a "deploy" against the un-hashed local `public/`.

**Product DECISION needed from the owner before building (one item, low-stakes):**
- **Trigger set + copy/tone.** Confirm: (a) **focus + 15-min interval** is the right trigger set, or whether to also check on **route change** (every hash nav) — the issue lists route-change as an option; I recommend *not* adding it (focus already covers the realistic "came back to the tab" case without a network hop per navigation). (b) Final banner copy — proposed: *"A new version of ShipASO is available — refresh to update."* with **Refresh** + dismissible **×**. (c) Whether dismiss should suppress for the session only (recommended) vs. permanently.

Everything else (no auto-reload, no backend route, compare against `/index.html`, fail-silent, inert in dev) follows directly from the issue and the existing architecture and needs no decision. Given it's explicitly **post-launch, low priority** (per #54's Scope), this is a fast win to schedule whenever there's slack — it closes the "but they never reload" gap that the #40 cache-busting work intentionally left open.

