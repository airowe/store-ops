# PRD — Issue #50: Agent controls — "Run now" button on the dashboard

**Status:** Ready to build (no product DECISION blocking — one small framing decision flagged in §8)
**Effort:** **S** (small; the run endpoints, trigger functions, and interstitial already exist)
**Owner sign-off needed before build:** No, but see §8 for one copy/scope decision worth a thumbs-up.

---

## 1. Problem & context

The logged-in dashboard (`viewDashboard`, `cloud/public/app.js:415`) opens with an authoritative agent-status line:

> "Autonomous agent **active** — re-checks your ranks & listing every Monday 09:00 UTC (and any competitors you add). It prepares every move; **you approve the push.**"
> — `cloud/public/app.js:424-427`

Every explicit claim there is real and verified:
- The weekly cron exists (`crons = ["0 9 * * 1"]` in `cloud/wrangler.toml` → `scheduled()` → `runWeeklySweep`, tier-gated by `canRunCron`).
- The cron **never pushes**: it persists runs as `awaiting_approval` (same path as `runApp`, `cloud/src/api/index.ts:895-900`); push commands are 403 until a human approves.

**The gap:** the banner implies an agent the user can *operate*, but on the dashboard there are **zero control surfaces**. The only way to trigger an agent run is to:
1. click an app card (`appCard`, `cloud/public/app.js:583` → `go("#/apps/" + a.id)`),
2. land on the app-detail view,
3. find the ASC run panel (`ascRunPanel`, `cloud/public/app.js:901`) and click **"▶ Run with ASC read"** (or opt into the blind **"▶ Run agent now"**).

So between Mondays, a user looking at "agent active" on the dashboard has no obvious button that says "do it now." The run machinery is fully built — endpoints, trigger functions, interstitial, error/retry handling — it's just **not surfaced at the dashboard altitude**, only one level deep.

**Why it matters:** this is a trust/credibility issue. The product's core promise is an *operable* autonomous agent. A status line that asserts activity with no adjacent control reads as marketing copy, not a live system. The issue itself frames this as "the first and cheapest fix" and "a convenience/trust improvement" — cheap because the endpoint already exists, and explicitly **post-launch-OK** because the weekly cron + connect-time first run already deliver the core loop.

---

## 2. Goal & non-goals

### Goal
Add a **"Run now"** control to the dashboard so a logged-in user can trigger an on-demand agent run per app without navigating into app detail and hunting for the run panel — reusing the existing `POST /apps/:id/run` endpoint and existing client trigger code, with honest framing (read+prepare only; same approval gate; never implies a push).

### Non-goals
- **No new backend endpoint.** `runApp` / `POST /apps/:id/run` (`cloud/src/api/index.ts:857-904, 1894-1896`) and `runAppWithAsc` / `run-asc` (`:917, :1897-1898`) already exist and are unchanged.
- **No ASC-key entry on the dashboard.** A dashboard "Run now" is the **blind** (public-data, name/description-only) run. Collecting a `.p8` is a multi-field credential flow that belongs on app detail (`ascRunPanel`), not on a card. (See §6.)
- **No auto-push, no auto-approve.** The button produces an `awaiting_approval` run and routes to the run screen — same gate as today.
- **No changes to the cron, `canRunCron`, billing tiers, or scheduling.**
- **No "run all apps" / portfolio-wide batch run** in this issue (possible follow-up; out of scope to keep this S).
- **No new run modes or overrides UI** (keyword/competitor seeding stays where it is).

---

## 3. Proposed approach (grounded in real files/functions)

The cheapest correct implementation reuses what already exists. There are two viable surfaces; this PRD recommends **both at low cost**, but a card-level button is the minimum.

### 3a. Reuse the existing client trigger
`triggerRun(appId, btn)` (`cloud/public/app.js:863-869`) already does exactly the right thing:
- disables the button, shows the agent-running spinner,
- renders the multi-step interstitial (`runInterstitial(RUN_STEPS)`, steps at `:854-861`),
- calls `api("POST", "/apps/" + appId + "/run")` (`:866`),
- on success: `toast("Agent finished — review the proposal.")` then `go("#/runs/" + r.id)` (`:867`),
- on failure: re-enables, restores label, shows the retry interstitial (`:868`).

The dashboard button is a **new call site** for this *existing* function. No new run logic.

**Important reuse note:** `triggerRun` currently hard-codes the restore label `"▶ Run agent now"` on error (`:868`) and replaces the whole `root()` via the interstitial. From the dashboard we don't want to nuke the dashboard DOM on success only to immediately `go("#/runs/:id")` (that's fine — we navigate away), but on **error** the interstitial's "Back" goes to `backHash` and "Try again" calls `onRetry`. We should pass a dashboard-appropriate `backHash`. Cleanest path: generalize `triggerRun` to accept optional `{ label, backHash }` so the card button restores the right label and the error "Back" returns to `#/` instead of `#/apps/:id`. This is a tiny, backward-compatible signature change (existing callers pass nothing → current defaults).

### 3b. Card-level "Run now" button (recommended primary surface)
In `appCard` (`cloud/public/app.js:576-593`), the card root has an `onclick` that navigates to detail (`:583`). Add a small **"Run now"** button into the card (e.g. into `row1` or a new footer row). The button's handler must **`stopPropagation()`** so clicking it triggers a run instead of bubbling to the card's navigate-to-detail `onclick`.

Behavior:
- Calls the generalized `triggerRun(a.id, btn, { label: "▶ Run now", backHash: "#/" })`.
- On success the interstitial settles and we route to `#/runs/:id` (already what `triggerRun` does).
- Honest microcopy near/under the button or as the toast: this is a read+prepare pass; you still approve the push.

### 3c. Optional: dashboard-level affordance next to the agent-status line
The agent-status line (`:424-427`) is the natural home for a single "the agent is active — **[Run a check now]**" affordance. If there's exactly one app, this can run that app directly; with multiple apps it should make clear it's per-app (so the simplest honest version routes the user to pick, or we keep run controls strictly on the cards). **Recommendation:** ship 3b (per-card) as the canonical surface and skip 3c, or make 3c purely a scroll-to-cards prompt. (Flagged as the one minor decision in §8.)

### 3d. Honesty framing (must-have copy)
A manual run is **read + prepare only** (public-data blind run from the dashboard), ending in `awaiting_approval`. Copy must not imply a push or imply ASC data was read:
- Button label: **"Run now"** (not "Push now", not "Update listing").
- Helper/toast: e.g. "Re-checks ranks & drafts changes on public data — you still approve before anything ships. Connect App Store Connect (on the app page) to also read your subtitle & keywords."
- This mirrors the existing honest blind-run framing at `cloud/public/app.js:928-932` and the run-detail narration at `:969`.

---

## 4. Exact files to change + new files

**No new files required.** This is intentionally a small surface-area change.

### `cloud/public/app.js` (primary change)
1. **`triggerRun` (`:863-869`)** — generalize signature to `triggerRun(appId, btn, opts)` where `opts = { label, backHash }`:
   - default `label = "▶ Run agent now"` (preserves existing app-detail caller at `:928`),
   - on success unchanged,
   - on error, restore `btn.textContent = label` and pass `backHash || ("#/apps/" + appId)` into `inter.fail(...)`.
   - Existing callers (`:868` retry, `:928` blind button) pass no `opts` → identical behavior.
2. **`appCard` (`:576-593`)** — add a "Run now" button into the card:
   - new `el("button", { class: "btn small", onclick: function (ev) { ev.stopPropagation(); triggerRun(a.id, this, { label: "▶ Run now", backHash: "#/" }); } }, ["▶ Run now"])`,
   - add the honest helper microcopy line (small/faint) near it,
   - ensure the button is keyboard-focusable and the card's navigate-`onclick` doesn't fire when the button is clicked (the `stopPropagation` handles click; for keyboard, the button is a real `<button>` so Enter activates it without bubbling).
3. **(Optional, 3c)** **`viewDashboard` agent-status line (`:424-427`)** — only if we add the dashboard-level affordance. Keep honest (links to cards / app page for the ASC read).

### `cloud/public/styles.css`
- Add a `.btn.small` (or reuse existing button sizing) and any card-footer layout for the new button so it sits cleanly inside `.appcard` without breaking the existing grid/flip-in animation (`:443`). Verify it doesn't overlap the `findingBadge` in `row1` (`:581-582`).

### `cloud/public/mock.js` (test backend — already supports this)
- **No change needed.** The mock already handles `POST /apps/:id/run` and returns an `awaiting_approval` run (`cloud/public/mock.js:995-1015`), and updates `app.latestRunSummary` (`:1015`). E2E will exercise the new button against this existing handler.

### Backend (`cloud/src/api/index.ts`)
- **No change.** `runApp` (`:857`), route wiring (`:1894-1896`), `awaiting_approval` persistence (`:895-900`), and ownership scoping via `requireOwnedApp` (`:864`) are all in place and correct.

---

## 5. Test plan (TDD, repo conventions)

The repo splits **pure-logic unit tests** (`vitest`, `src/**/*.spec.ts`, node env — `cloud/vitest.config.ts`) from **E2E** (`playwright`, `cloud/tests/e2e/*.e2e.ts` against `mock.js` — `cloud/playwright.config.ts`). The new behavior is **UI/integration**, so the primary coverage is E2E; the backend endpoint it calls is already covered.

Follow TDD: write the failing E2E first, then add the button until it passes.

### E2E (new spec or added cases in `cloud/tests/e2e/flows.e2e.ts`)
Pattern: drive the real `app.js` against `mock.js`, using `getByRole("button", { name: ... })` (the established selector style — see `cloud/tests/e2e/flows.e2e.ts:19, :71, :148, :157`). Use `cloud/tests/e2e/helpers.ts` to seed a connected app (same setup the existing flows use).

1. **Button is visible on the dashboard card.** With ≥1 connected app, `page.getByRole("button", { name: /run now/i })` is visible on the card.
2. **Clicking "Run now" triggers a run and lands on the run screen.** Click → the run interstitial shows → on settle the URL is `#/runs/:id` and the **"Approval gate"** heading is visible (the gate heading is the existing E2E anchor — `flows.e2e.ts:63, :91`). Assert the proposal is `awaiting_approval` (NOT pushed) — i.e. push/upload commands are NOT shown until approved (mirror `flows.e2e.ts:95-103`).
3. **Click does not navigate to app detail.** Clicking "Run now" must trigger a run, not bounce to `#/apps/:id` (verifies `stopPropagation`). Assert we end on `#/runs/:id`, not on the app-detail heading.
4. **Honest framing present.** The card (or toast) text asserts read+prepare framing and does **not** contain push/ship language — e.g. expect `getByText(/you (still )?approve/i)` near the control and `toHaveCount(0)` for any "pushed"/"updated your listing" copy at run time (mirrors the negative assertion style at `flows.e2e.ts:68`).
5. **Failure path.** Drive the mock to fail the run (extend `mock.js` test hooks if a forced-failure toggle exists, or assert via the existing error interstitial) → the retry interstitial appears, "Back" returns to `#/` (the dashboard), and the button label restores to "▶ Run now". (If the mock has no failure injection, scope this to a follow-up rather than adding mock complexity — flag in PR.)

### Unit (`*.spec.ts`)
- If `triggerRun`'s `opts` handling is extracted into a tiny pure helper (e.g. resolving `{ label, backHash }` defaults), add a colocated `*.spec.ts` with parameterized cases (default vs dashboard opts). Strong assertions, no unexplained literals — per repo testing standards. If the change stays inline in `app.js` (no build step, untestable in vitest node env), rely on E2E and note it in the PR.
- **No new backend unit tests** — `runApp`/`run-asc` behavior is unchanged and already covered by the existing api suite.

### Manual / quality gates before commit
Run the repo gates (lint, typecheck, vitest, playwright) per the user's standing workflow rule. Confirm the new button renders correctly with the `flip-in` card animation and doesn't shift the grid.

---

## 6. Honesty & security considerations

This product's core value is **honesty** — these are non-negotiable and the design above already respects them:

1. **Never present unseen data as measured.** A dashboard "Run now" is the **blind** run (`POST /apps/:id/run`, `runApp` at `:857`) — it reads public iTunes data only, with `hasAscKey: false` (`:886`), so subtitle/keywords are **not** read and the proposal honestly omits them (the run-detail view already narrates this at `app.js:969` and `:1486`). The button copy must say so. We must NOT label the dashboard button "Run with ASC read" or imply live-listing data.
2. **Never persist the `.p8`.** The dashboard button deliberately carries **no credential entry** — it cannot leak a `.p8` because it never collects one. The ASC-read path (`runAppWithAsc`, `:917`) stays on app detail, where the `.p8` is read in-memory via `FileReader` and never uploaded/logged (`p8FileInput`, `:874-889`) and is sent once per request, never stored (`:911-913`, mirrored server-side at `:906-913`). This PRD does not touch that posture.
3. **The agent NEVER auto-pushes.** "Run now" persists `status: "awaiting_approval"` (`:895-900`) and routes to the human approval gate. Push commands remain 403 until a human approves (existing behavior, `cloud/src/api/index.ts:1312` and the push routes at `:1923-1934`). The button label and toast must avoid any push/ship verb.
4. **Ownership scoping.** Every run is already scoped to the user via `requireOwnedApp` (`:864`); the dashboard only ever passes `a.id` from the user's own `/apps` list (`viewDashboard`, `:418`). No cross-tenant exposure introduced.
5. **No new attack surface.** No new endpoint, no new input fields, no new persisted data. The only new code is a client button that calls an existing, already-authed, already-rate-by-tier endpoint.
6. **Abuse / cost note (low):** the button lets a user trigger runs on demand. Runs cost compute + outbound fetches. The endpoint already exists and is reachable today (app-detail blind run, connect-time run), so this doesn't change the threat model — but if there's no per-app run cooldown today, a "Run now" makes rapid re-runs one click away. Mitigation in-scope: the button disables itself during a run (existing `triggerRun` behavior, `:864`). Out-of-scope but worth a follow-up issue: a soft cooldown / "last run was N min ago" hint. Do not build it here.

---

## 7. Risks & rollout

| Risk | Likelihood | Mitigation |
|---|---|---|
| Card click vs button click conflict (button bubbles to card's navigate `onclick` at `:583`) | Med | `ev.stopPropagation()` in the button handler; E2E case #3 asserts we don't navigate to detail. |
| Misleading copy implies a push or implies ASC data was read | Med (it's the whole honesty risk) | Explicit blind/read+prepare framing (§3d, §6); E2E case #4 negative-asserts push/ship language. |
| `triggerRun` signature change breaks existing app-detail callers | Low | New `opts` is optional; defaults reproduce current labels/backHash exactly. Existing E2E (`flows.e2e.ts:148-157`) regress-guards the app-detail run buttons. |
| Visual regression in card layout / `flip-in` animation / badge overlap | Low | `styles.css` adjustment + manual check + E2E visibility assertion; the screenshot-gallery E2E is unrelated so no snapshot churn. |
| Users expect "Run now" to also do the ASC read | Med | Helper copy links to the app page for the ASC read; keeps dashboard run honest-but-conservative. |

**Rollout:** No flag needed — it's purely additive client UI on a static, no-build dashboard (`public/app.js`), deployed with the normal Pages deploy (`cloud/DEPLOY.md`). No DB migration (`schema.sql` untouched), no Worker change, no config. Safe to ship behind a normal PR. If desired, can be gated by simply shipping the card button first and deferring the optional dashboard-line affordance (3c).

---

## 8. Effort estimate & decision needed

**Effort: S.** Concretely: generalize one function (`triggerRun`), add one button + microcopy to `appCard`, minor CSS, and 4–5 E2E cases. No backend, no new files, no migration. The hard parts (endpoint, trigger flow, interstitial, error/retry, honest run-detail narration) already exist.

**Product DECISION needed before building?** Mostly **no** — this is a surface for existing, owner-approved behavior. **One small decision** worth a thumbs-up from the owner:

- **Scope of the surface:** card-level "Run now" **only** (recommended), vs. also adding the dashboard agent-status-line affordance (3c). The card-level button is unambiguous and per-app; the status-line affordance is nicer copy but needs a "which app?" answer when there are multiple apps. **Recommendation: ship card-level only; defer 3c.**
- **(Trivial copy check)** Exact button label — "Run now" (issue's wording) vs "Run a check now" / "Re-check now." Recommend **"Run now"** to match the issue and keep it short, with the honesty in the adjacent helper line, not the label.

Everything else is implementation detail and respects the existing honesty/security invariants, so it does not require a separate owner decision before building.

