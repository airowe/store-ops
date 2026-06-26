# PRD — Editable proposals on the run page + capture edits as an RLHF signal (#39)

> Status: Draft for owner review · Effort: **M** (Part 1) + **M/L** (Part 2) · Requires a product DECISION before Part 2 (retention + opt-out) — see §8.

---

## 1. Problem & context

When the agent finishes a run it produces `proposedCopy` (name / subtitle / keyword field / promo) and stops at the human approval gate. The run page renders that proposal as a **read-only** PR-style diff and offers exactly two actions: **Approve** or **Reject**.

- The diff UI is read-only: `diffCard(current, proposed)` in `cloud/public/app.js:1507` only *displays* `current[field] → proposed[field]` with char bars — there is no input.
- Approve hands off the **original** proposal verbatim. `decideRun` (`cloud/src/api/index.ts:1301`) records the approval and returns `trace.pushCommands` straight off the persisted trace (`cloud/src/api/index.ts:1340-1346`). Every downstream handoff reads the *stored* proposal, never an edited one:
  - `pushCommandsRoute` → `trace.pushCommands` (`cloud/src/api/index.ts:1361`)
  - `fastlaneZipRoute` → `buildFastlaneBundle(trace.proposedCopy)` (`cloud/src/api/index.ts:1384`)
  - `githubPrRoute` → `buildFastlaneBundle(trace.proposedCopy)` (`cloud/src/api/index.ts:1425`)
  - `ascPushRoute` → `applyAscMetadata({ copy: trace.proposedCopy })` (`cloud/src/api/index.ts:1570`)

**What's broken/missing:** a user who sees a *nearly-right* proposal (e.g. a one-word swap, a better subtitle phrase) has no way to fix it in place. Their only escape valve is **Reject → re-run**, which is slow, non-deterministic, and often produces the same thin output. A real example called out in the issue: a thin proposal for *Heathen* that a human could salvage in ten seconds is instead rejected, and the ship never happens. This costs conversion (fewer approved pushes) and throws away the single most valuable training signal this product can collect.

**Why it matters (compounding):** every human edit is a labeled `(proposal → human-shipped final)` pair — exactly the preference data #38 (compose-from-scratch) needs to learn a better composer, and that #37/#28 need to tune scoring/composition. The product is currently *generating* this signal at the moment of approval and *discarding* it.

This is a two-part feature: **(1)** a shippable near-term UX change (editable fields + push-the-edits), and **(2)** a larger data/feedback capture layer (persist the edit deltas as a preference dataset).

---

## 2. Goal & non-goals

### Goals
1. **Editable proposals.** On the run page, the proposed `name`, `subtitle`, `keywords`, and `promo` fields become editable before approval, with the **same hard-limit + keyword-rule validation already enforced in the engine** (`validateCopy`, `cloud/src/engine/optimize.ts:77`).
2. **Edited values are what ship.** Approve / Fastlane zip / GitHub PR / ASC push all use the **edited** copy, not the original proposal — staged at approval time, validated server-side, and never silently re-running the agent.
3. **Capture the edit as a signal (Part 2).** Persist `(original proposal, edited final, decision)` per field, scoped per account, with explicit retention, as a preference dataset for the optimizer.

### Non-goals
- No learned/online model training in this PRD. Part 2 ships the **capture + storage + export**, not a training pipeline or a new composer (that's #38).
- No change to the agent run loop / scoring (#37/#28) — editing **stages** values, it does **not** re-trigger a run (explicit issue constraint).
- No auto-push. The agent still never pushes; the human still clicks Approve, and the irreversible store write remains opt-in and credential-ephemeral (§6).
- No editing of `description` in Part 1 (it's a 4000-char body, not part of the current diff card; can follow later).
- No multi-user review/commenting on edits.

---

## 3. Proposed approach (grounded in real files)

### Part 1 — Editable proposals (near-term, shippable)

**3.1 Client: make `diffCard` editable (`cloud/public/app.js:1507`).**
Replace the read-only "Proposed" side (`side("now", …)`, app.js:1524-1534) with a `<textarea>`/`<input>` bound to a per-run **edit buffer** `edited = { ...R.proposedCopy }`. On each `input` event:
- Recompute the char count + bar using the existing `LIMITS` map (`cloud/public/app.js:21`) — the bar/warn logic already exists at app.js:1525-1527 and is reused verbatim.
- Run a **client mirror of `validateCopy`** for instant feedback (over-limit, keyword-field spaces, title/subtitle dup) so the user sees red before they approve. The client check is advisory; the **server is authoritative** (§3.3).
- Keep an "edited" vs "matches agent" indicator and a **"Reset to agent's proposal"** affordance per field.

The diff "changed/added" tagging (app.js:1538-1548) and the no-op detection (`isNoOpProposal`, app.js:1942) keep working — they now compare `current` against the **edit buffer**.

**3.2 Client: thread edits through approval + handoff.**
`gateCard` (app.js:1900) and `decide` (app.js:2292) currently `POST /runs/:id/approve` with no body. Change `decide` to send the edit buffer:
```js
api("POST", "/runs/" + runId + "/approve", { decision: "approve", editedCopy: edited })
```
Block the Approve button (with an inline message) while the client validator reports any field invalid, mirroring the engine's `validation.pass`. Commands box / Fastlane / ASC push panels then render from the **approved (edited) copy** returned by the server.

**3.3 Server: accept + validate + stage edits at the gate (`decideRun`, `cloud/src/api/index.ts:1301`).**
Extend `ApproveBody` (api/index.ts:1290) to `{ decision?, editedCopy?: Partial<CopyFields> }`. In `decideRun`, when `decision === "approved"` and `editedCopy` is present:
1. Merge edits over the run's `trace.proposedCopy` (only the editable fields: name/subtitle/keywords/promo; ignore unknown keys).
2. **Re-validate with the engine's own `validateCopy`** (import from `../engine/optimize.js`). If `!validation.pass`, throw `HttpError(400, …)` with the failing checks — an over-limit or keyword-rule-violating edit can never be staged. This reuses the *exact* server-side rules (`CHAR_LIMITS`, comma/space, title-subtitle dedupe) so the client mirror can never be the only gate.
3. Persist the **finalized copy** so every downstream handoff reads it. Two sub-options (DECISION-free, recommend (a)):
   - **(a) Rewrite the trace's `proposedCopy` + `pushCommands` on approval** — re-derive `pushCommands` from the edited copy (the engine already has the push-command builder used at run time) and `UPDATE runs.reasoning_json`. Then `pushCommandsRoute` / `fastlaneZipRoute` / `githubPrRoute` / `ascPushRoute` need **zero changes** — they keep reading `trace.proposedCopy` / `trace.pushCommands`, which are now the edited values. This is the smallest blast radius.
   - (b) Store edited copy in a side column and teach every handoff to prefer it. More routes touched, more drift risk. **Not recommended.**
4. Update the `proposals` rows for the run to the final values (so `proposals.value`/`char_count` reflect what shipped) — extend `persistRun`/add a small `updateProposals(db, runId, copy)` in `cloud/src/d1.ts`.

**Honesty guard:** approval with edits must still pass `isNoOpProposal`-style logic on the server side too — if the edited copy equals current live copy (case/space-insensitive), we still allow approval but the run is an honest no-op (no fabricated "change"). The push-gate guarantee (commands withheld until approved) is untouched: `serializeRunResult` (api/index.ts:250) still gates `pushCommands` on `approved`.

### Part 2 — RLHF capture (bigger, later)

**3.4 New table `proposal_edits`** (see §4) records, **per field, at approval time**: `run_id`, `app_id`, `user_id`, `field`, `original_value`, `final_value`, `decision`, `edited` (bool), `created_at`. Written inside the same `recordApproval` batch (`cloud/src/d1.ts:573`) so it's atomic with the gate decision and can never disagree with it.
- `decision = 'rejected'` rows are also captured (a rejection is a strong negative preference signal — "none of this was acceptable").
- `original_value` = the agent's `trace.proposedCopy[field]`; `final_value` = the edited value (== original when untouched). `edited = original !== final`.

**3.5 Export surface for the dataset.** Add an internal/owner-only `GET /admin/preference-data` (or a script under `cloud/scripts/`) that emits the JSONL preference set `{ app_id (or hashed), field, current, proposal, final, decision, edited }`. This is what #38's composer trains against. Owner-gated (not a per-user route); no PII beyond the user's own listing copy, account-scoped.

**3.6 Feedback loop (out of scope, noted for #38):** the optimizer reads aggregate edit patterns (e.g. "subtitle composed-from-scratch proposals are edited 80% of the time") to tune `composeSubtitle`/bucketing. Not built here.

---

## 4. Exact files to change + new files

### Changed files
| File | Change |
|---|---|
| `cloud/public/app.js` | `diffCard` (1507) → editable inputs + per-run edit buffer + live client validation; `gateCard` (1900) → disable Approve while invalid + "reset to proposal"; `decide` (2292) → POST `editedCopy`; render handoff from approved/edited copy. |
| `cloud/src/api/index.ts` | `ApproveBody` (1290) gains `editedCopy`; `decideRun` (1301) merges + server-validates via `validateCopy`, re-derives `pushCommands`, rewrites the trace + proposals (Part 1). No changes needed to `pushCommandsRoute`/`fastlaneZipRoute`/`githubPrRoute`/`ascPushRoute` under approach (a). |
| `cloud/src/d1.ts` | Add `updateRunCopy(db, runId, proposedCopy, pushCommands)` (rewrites `reasoning_json`) + `updateProposals`; (Part 2) write `proposal_edits` rows inside the `recordApproval` batch (573). |
| `cloud/schema.sql` | (Part 2) add `proposal_edits` table + migration `ALTER`/`CREATE` block (mirror the existing migration-comment convention, e.g. lines 37-46, 133-134). |
| `cloud/public/mock.js` | Teach the mock `/runs/:id/approve` handler (mock.js:1084) to accept `editedCopy`, re-validate, and reflect edited copy back — so E2E runs against the mock exercise the real flow (the funnel/flows e2e specs drive the mock). |

### New files
| File | Purpose |
|---|---|
| `cloud/src/api/proposalEdit.ts` (+ `proposalEdit.spec.ts`) | Pure helper `finalizeEditedCopy(proposed, editedCopy)` → `{ copy, validation }` (merge + clamp to editable fields + `validateCopy`). Keeps `decideRun` thin and the logic unit-testable in the fast `node` vitest env (no Worker runtime). |
| `cloud/src/engine/preferenceSignal.ts` (+ `.spec.ts`) | (Part 2) pure `buildPreferenceRows({ proposed, final, decision })` → `EditRow[]` (per-field diff + `edited` flag). Reused by `recordApproval` and the export. |
| `cloud/tests/e2e/editProposal.e2e.ts` | Playwright flow: run → edit a field → over-limit blocks approve → valid edit → approve → handoff shows edited value. |

Note: the `whatsNew` field already exists in `CopyFields` (`cloud/src/engine/optimize.ts:22`); editable scope for Part 1 is name/subtitle/keywords/promo to match the current diff card.

---

## 5. Test plan (TDD, repo conventions: `*.spec.ts` colocated unit, `*.e2e.ts` Playwright)

Follow the repo's scaffold-stub → failing-test → implement order. Pure logic in `*.spec.ts` (vitest `node` env, `vitest.config.ts` includes `src/**/*.spec.ts`); UI in `*.e2e.ts` against the mock (`playwright.config.ts`).

### Unit (`*.spec.ts`, node env — strong assertions, parameterized)
- **`cloud/src/api/proposalEdit.spec.ts`** (`finalizeEditedCopy`):
  - merges only editable fields; ignores unknown/`description` keys.
  - rejects an over-limit subtitle (31 chars) → `validation.pass === false`, field check `ok:false` with the exact over-by count.
  - rejects a keyword field with `", "` spacing and with a title-dup term (mirrors `validateCopy` rules at optimize.ts:100-108).
  - identity case: empty `editedCopy` → copy === original proposal, `pass` matches original.
- **`cloud/src/engine/preferenceSignal.spec.ts`**: per-field `edited` flag true only on real change; case/space-only change classified per the `isNoOpProposal` norm; rejected decision still emits rows.
- **Extend `cloud/src/d1.recordApproval.spec.ts`** (file exists): approving with `editedCopy` writes the finalized `proposals` rows + (Part 2) `proposal_edits` rows **atomically** with the approval; second approval still conflicts (UNIQUE(run_id) at schema.sql:114).
- **API-level `decideRun`**: approve with an invalid edit → `400` and **no** approval row written (gate not crossed); approve with a valid edit → `200`, `pushCommands` derived from edited copy, `getRun` trace now carries edited `proposedCopy`. (Run in the Worker-pool suite per the `vitest-pool-workers` note in `vitest.config.ts`.)

### E2E (`cloud/tests/e2e/editProposal.e2e.ts`, Playwright vs mock)
- Edit the subtitle to 31 chars → char bar goes `warn`, Approve disabled, inline message shown.
- Fix to a valid value → Approve enabled → click → handoff (commands / Fastlane / "approved" copy) shows the **edited** value, not the agent's original.
- "Reset to agent's proposal" restores the original and re-enables Approve.
- Regression: a no-op edit (whitespace only) keeps the honest "nothing to push" path (`isNoOpProposal`, app.js:1942).

### Guard tests (no-regression for #30 / honesty)
- A run with no ASC read still shows subtitle/keywords as **unseen**, not editable-into-existence beyond what was proposed (don't let editing fabricate fields the agent never proposed; only fields present in `proposedCopy` are editable).

---

## 6. Honesty / security considerations

This product's core promise is honesty; the feature must not weaken it.

1. **Never present unseen data as measured.** Editing only exposes fields the agent actually proposed (`R.proposedCopy`). On a no-key run, subtitle/keywords are **unseen** and remain non-editable (the diff already renders them as such, app.js:1558-1561). We do not let a user "edit" a field into a fabricated baseline. An edited copy that equals live copy is reported as an honest no-op, not a "change."
2. **Validation is server-authoritative.** The client `validateCopy` mirror is advisory only; `decideRun` re-runs the engine's `validateCopy` (optimize.ts:77) before staging, so an over-limit or keyword-rule-violating value can **never** be staged for push (explicit issue constraint). Apple's hard limits (`CHAR_LIMITS`, constants.ts:9) stay enforced in code.
3. **The agent never auto-pushes.** Editing **stages** values for the human gate; it does not re-trigger a run and does not push. The push-command withholding gate (`serializeRunResult`, api/index.ts:262; `pushCommandsRoute` 403 until approved, api/index.ts:1358) is unchanged. The store write stays opt-in (`ASC_WRITE_ENABLED`, api/index.ts:1541) and credential-handoff-first (Fastlane).
4. **`.p8` is never persisted.** This feature touches no credential path; the edit channel is metadata only. ASC verify/push keep their in-request, never-stored, never-logged `.p8` posture (api/index.ts:1483, 1533). The PRD adds no new place that could capture a key.
5. **Preference data privacy (Part 2).** Edits are the **user's own listing copy** — store account-scoped (`user_id` on `proposal_edits`, cascade-deleted with the app via the run FK, mirroring `deleteApp` at d1.ts:372). **Retention must be explicit** and surfaced (see §8 DECISION). The export is owner-gated; any external/aggregate use must hash or drop `app_id`.
6. **Audit integrity.** `proposal_edits` is written in the same atomic batch as `recordApproval` (d1.ts:585) so the captured signal can never disagree with the recorded decision.

---

## 7. Risks & rollout

| Risk | Mitigation |
|---|---|
| Client/server validators drift, letting an invalid edit feel "approvable" then 400 at the gate | Server is authoritative; client mirror is a thin port of `validateCopy`. Add a unit test asserting client and server agree on a fixed table of cases (parameterized). |
| Rewriting `reasoning_json` on approval (approach a) corrupts the trace | Rewrite is additive to `proposedCopy`/`pushCommands` only; covered by a `getRun` round-trip test. Keep a `proposals` row update so the normalized record matches. |
| Edited keyword field passes limits but tanks ranking (user foot-gun) | Out of scope to prevent; the diff + char bars + keyword-rule warnings already coach. Captured as preference signal regardless. |
| Part 2 schema migration on a live D1 | Ship `proposal_edits` as `CREATE TABLE IF NOT EXISTS` + documented `ALTER`/`CREATE` migration block (existing convention, schema.sql:37-46). Nullable/defaulted columns only; no backfill required. |
| Editing perceived as "the agent was wrong" | Framing: "tweak before you ship." Keep "Reset to agent's proposal" prominent. |

**Rollout:**
- **Phase 1 (this PRD core):** Part 1 client + server, behind no flag (it's strictly safer than today — same gate, validated). Ship after unit + E2E green.
- **Phase 2:** `proposal_edits` capture (write-only, no UI) — invisible to users beyond a one-line retention note. Land once the DECISION (§8) is made.
- **Phase 3 (separate issue, feeds #38):** export + optimizer tuning. Not in this PRD.

---

## 8. Effort & decision

**Effort:**
- **Part 1 (editable proposals + push-the-edits): M.** Bounded to `diffCard`/`gateCard`/`decide` in app.js, `decideRun` + one pure helper in api, a small d1 update, and the mock. Approach (a) means zero changes to the four handoff routes. ~2-3 focused days with tests.
- **Part 2 (capture): M; full dataset/export + tuning: L** (the L lives mostly in #38).

**Needs a product DECISION from the owner before building Part 2** (Part 1 can proceed now):
1. **Retention policy + disclosure:** how long are `proposal_edits` kept, is there a user-facing opt-out / "don't use my edits to improve ShipASO" toggle, and where is it disclosed (privacy copy / settings)? Capture must not start before this is decided. (`commercial/OFFER.md` / privacy copy is the likely home.)
2. **Export scope:** is `app_id` retained, hashed, or dropped in any aggregate/training export?
3. **Editable scope confirmation:** Part 1 covers name/subtitle/keywords/promo; confirm whether `description`/`whatsNew` editing is wanted now or deferred.

Part 1 is implementation-ready today and delivers the immediate conversion win (salvage a thin proposal in place); Part 2 is gated only on the retention/opt-out decision above.

