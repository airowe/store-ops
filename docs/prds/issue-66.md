# PRD — Issue #66: ascRead never reads subtitle/keywords/name copy from the ASC localization

> **Status: RESOLVED. This PRD documents the resolution rather than proposing new work.**
> Issue #66's title — *"Superseded by #69 — PRD should just document the resolution"* — is correct. The capability #66 asked for (read the real `name`/`subtitle`/`keywords`/`promotionalText`/`description` from the ASC localization on a keyed run, surface a true `seen` flag, feed real values into the optimizer + coverage, and stop seeding keywords from the app name) is **implemented and merged on `main`** across a small cluster of follow-up fixes (#69, #75, #77) plus the read-but-empty honesty fix. The original #66 commit was reverted and re-delivered correctly. The remaining action is to **close #66 as completed by #69/#75/#77** after a verification pass. No new product decision is required.

---

## 1. Problem & context

### What #66 originally reported
On a KEYED run (ASC read), the screenshot reader's `Localization` type captured only `{ locale, id }` and used the localization solely to locate screenshots — **discarding** the copy attributes (`name`, `subtitle`, `keywords`, `promotionalText`, `description`) present on that same object. As a result, on the live run `c63edf04` (Mangia, keyed):

- `currentKeywords` were **`seedKeywordsFromName` derived guesses** (`recipe,cooking,meal,planner,...`), not the real ASC keyword field, yet coverage marked keywords `seen:true` (92/100) and ran duplicate detection on them.
- `currentSubtitle` was absent → coverage showed subtitle `unseen` even though a working key could have read it.

This is the **fabricated-as-measured honesty violation** (same class as #65): derived guesses presented as observed live data. This product's entire value proposition is honesty — never present unseen/derived data as measured.

### Why the issue is "superseded"
The original #66 implementation (`15807e6 fix: read real listing copy from ASC localization, not derived guesses (#66)`) was **reverted** (`ba88fa9 Revert "...(#66)"`) because it read `name`/`subtitle` off the **version localization**, where App Store Connect does not store them — they live on the **app-level `appInfoLocalizations`** layer. So a populated subtitle still read as empty and the name read stale. That misdiagnosis is exactly what #69 documents (Mangia run `43aaec8d`: real subtitle `AI Recipe Saver & Meal Planner` read as `''`, name read as the old `Mangia - Recipe Manager`).

The correct fix landed across:
- **#69** — read `name`+`subtitle` from `appInfoLocalizations`; distinguish read-but-empty from unseen; thread `description` to the keyword reasoner.
- **#75** — when a real ASC keyword field was read, target THOSE curated keywords instead of tokenizing the app name.
- **#77** — a bare connect (no key, no live listing) runs an audit-only pass with no fabricated name-token keyword targets.

All three are merged on `main` and carry specs.

---

## 2. Goal & non-goals

### Goal (achieved)
On a keyed run, read the user's real live listing copy from ASC, surface it honestly (measured-empty `"empty"` is distinct from unseen), feed the real values into the optimizer floor and coverage, and never present derived guesses as live data.

### Non-goals
- Reading copy attributes off the **screenshot** reader's `Localization` type (`ascRead.ts:93`). That reader is screenshots-only and intentionally stays `{ id, locale }` — copy comes from the dedicated `readAscLocalization` / `readAscAllLocales` readers. Widening the screenshot type would be redundant.
- Re-enabling the deferred Workers-AI keyword reasoner (tracked by #57; #75 is the launch-safe deterministic path).
- Any write-path change. Reads only; the agent never auto-pushes.

---

## 3. Proposed approach (as implemented — grounded in real files)

### 3a. Read the live copy from the correct ASC layer — `readAscLocalization`
`cloud/src/engine/ascWrite.ts:268-327` — `readAscLocalization(fetchFn, {token, appId, locale})` returns a `LiveListingCopy`:
- `keywords` / `promo` / `description` / `whatsNew` come from the **version** localization attributes (`ascWrite.ts:43-56`, `319-326`).
- `name` / `subtitle` come from the **`appInfoLocalizations`** layer via `readAscAppInfo`, with locale fallback (`en-US` → base-lang `en` → first), best-effort so an appInfo failure leaves them `undefined` rather than asserting a false empty (`ascWrite.ts:293-326`). This is the #69 correction of the reverted #66 attempt.
- `LiveListingCopy` type: `ascWrite.ts:59-66`.
- The all-locales variant `readAscAllLocales` (`ascWrite.ts:681-732`) applies the same appInfo-layer join per locale for the localization-expansion / completeness checks.

### 3b. Wire live copy into the run with an honest empty-vs-unseen distinction — `runAscRoute`
`cloud/src/api/index.ts:937-984`:
- After a SUCCESSFUL ASC read, `liveSubtitle/liveKeywords/liveName/liveDescription` are captured from `readAscLocalization` (`index.ts:944-948`).
- `overrides.baseCopy` coalesces **read-but-empty to `""`** (`subtitle: liveSubtitle ?? ""`, `keywords: liveKeywords ?? ""`, `index.ts:975-984`) with an explicit comment: an `undefined` from a successful read means the field is EMPTY (seen), not unknown — so it propagates as `"empty"`, never collapsing into the false `"unseen"` state. This is commit `eabb036`.
- `description` is threaded so the #57 keyword reasoner can run on keyed runs (`index.ts:979-982`).

### 3c. Coverage uses a true `seen` flag — `metadataCoverage`
`cloud/src/engine/metadataCoverage.ts:154-164`: `fieldFill` sets `seen = raw !== undefined`. An unseen field carries no fabricated fill (`used`/`fillPct` stay 0, UI shows UNKNOWN); a measured-empty field is `seen:true` with `used:0`. `coverageForRun(result.currentCopy, app.name)` is called at `index.ts:1015`.

### 3d. Stop seeding keywords from the name on keyed runs — `reasonedKeywords`
`cloud/src/api/runConfig.ts:178-209`: when a real ASC keyword field was read (`liveKeywordField`), `parseKeywordField` (`runConfig.ts:211-214`) splits it and those become the target set (`runConfig.ts:191-194`, the #75 Option-A path). `seedKeywordsFromName` (`runConfig.ts:75`) is now only the fallback for a bare connect with no description and no live keyword field (`runConfig.ts:196-208`). #77 makes the no-key connect audit-only.

### 3e. PII-safe boundary preserved
Only `findings` + `ascContext` cross to the client; the raw ASC snapshot stays server-side (`index.ts:996-1008`). The ephemeral token is per-request, never persisted/logged/returned; the `.p8` is used only to mint the JWT (`index.ts:931-936`) and is never persisted.

---

## 4. Files changed (already landed) + verification targets

**No new files needed.** The resolution touched, on `main`:

| File | Role in the fix | Key lines |
|---|---|---|
| `cloud/src/engine/ascWrite.ts` | `readAscLocalization`, `readAscAllLocales`, `LiveListingCopy`, appInfo-layer join for name/subtitle | 43-66, 268-327, 681-732 |
| `cloud/src/api/index.ts` | keyed-run wiring; read-but-empty → `""`; `baseCopy`; coverage call | 937-984, 1015 |
| `cloud/src/api/runConfig.ts` | target real keyword field; name-seeder demoted to fallback | 75, 178-214 |
| `cloud/src/engine/metadataCoverage.ts` | `seen` flag (measured-empty vs unseen) | 154-164 |
| `cloud/src/engine/optimize.ts` | optimizer preserves a strong live subtitle/keywords (`base.subtitle`/`base.keywords`) | 215, 266-304 |

**Relevant merged commits:** `c0a3e44 (#69)`, `eabb036` (read-but-empty vs unseen), `c2044c7 (#75 #57)`, `e16c788 (#77)`. Reverted original: `15807e6 (#66)` → `ba88fa9`.

**The only remaining change for #66 itself: close the issue** with a comment pointing at #69/#75/#77 and the verification result below. Optionally add one regression spec (4c) if not already covered.

---

## 5. Test plan (TDD, `*.spec.ts`)

Existing coverage to confirm green (these encode the #66 acceptance criteria):

- **`cloud/src/engine/ascWrite.spec.ts`** — "reads name + subtitle from appInfoLocalizations, copy from the version localization" (~:173) asserts a POPULATED subtitle is read, not reported empty (`:204`); plus version-list/empty-field guards (`:45, :239, :280, :446, :483`).
- **`cloud/src/api/runConfig.spec.ts`** — the real-keyword-field-over-name-tokens path (#75) and the bare-connect name-seeder fallback (#77).
- **`cloud/src/engine/metadataCoverage.spec.ts`** — `seen` true for measured-empty vs false for unseen; no fabricated fill on unseen.
- **`cloud/src/engine/ascRead.spec.ts`** — snapshot/locale reader behavior.

Suggested new regression spec (stub → failing test → confirm) to lock #66's exact scenario at the run boundary, if not already present:

1. **Unit (run wiring)** — given a successful `readAscLocalization` returning `{ subtitle: undefined, keywords: "" }`, assert `overrides.baseCopy.subtitle === ""` and `keywords === ""` (read-but-empty → seen), and that `currentCopy` produces `coverage.fieldFill` with `seen:true, used:0` for both — NOT a derived keyword string.
2. **Unit (no-key contrast)** — a no-key run leaves subtitle/keywords `undefined` → `fieldFill.seen:false` (unseen), with zero fabricated fill.
3. **Unit (keyword source)** — when the live keyword field is non-empty, `reasonedKeywords` targets exactly the parsed live terms, never `seedKeywordsFromName(name)` output.

Run gates before any close/commit: `npm run lint && npm run typecheck && npm test` in `cloud/` (per repo TDD + quality-gate conventions). Commit only with explicit owner approval.

---

## 6. Honesty & security considerations

- **No unseen-as-measured.** Core of the fix: a successful read that returns `undefined` means the field is genuinely empty (→ render `"empty"`, `seen:true`); an absent read means `unseen` (`seen:false`, no fabricated fill). The prior bug rendered derived name-token guesses as live `seen:true` data — eliminated.
- **No derived data presented as live.** Name-token seeding is demoted to a fallback only when nothing real was read; keyed runs target the user's own curated keyword field (#75).
- **`.p8` never persisted.** Used only in-memory to mint the ephemeral JWT (`index.ts:931-936`); not written to D1 or logs.
- **Token never leaks.** Per-request `Bearer` only; `ascError` (`ascWrite.ts:734-745`) strips it from thrown errors; the raw snapshot stays server-side, only `findings`+`ascContext` cross the boundary.
- **Agent never auto-pushes.** This is read-only; writes remain a separate, explicitly-invoked path.

---

## 7. Risks & rollout

- **Already shipped on `main`** — rollout risk is retrospective. Primary residual risk: a key whose role can read the version localization but **not** `appInfoLocalizations` → name/subtitle degrade to `undefined` (honest unseen), correctly not asserted as empty (`ascWrite.ts:301-315`). Acceptable and honest.
- **Locale mismatch** (en-US absent): handled by the base-language → first-locale fallback (`ascWrite.ts:304-307`); #69 also surfaces which version/locale/state was read for verifiability.
- **Regression guard:** the suggested spec (Section 5) pins the read-but-empty contract so a future refactor can't silently reintroduce the `unseen`/derived-guess confusion.

---

## 8. Effort estimate & decision needed

- **Effort to close #66: S** — verification pass (run lint/typecheck/test, optionally add the one regression spec from §5) + close with a comment crediting #69/#75/#77.
- **Effort the resolution actually cost (historical): M** — spread across #69/#75/#77.
- **Product decision required from owner? No.** The behavior is fully specified by the honesty principle and already merged. The only owner action is approving the close (and any commit, per the no-commit-without-approval rule).

