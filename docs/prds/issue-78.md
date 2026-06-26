# PRD — Localization roadmap (vs TryAstro), ASA data gap, screenshot localization

**Issue:** #78 — Competitive intel + add-on roadmap: localization (vs TryAstro), ASA data gap, screenshot localization
**Status:** Draft for owner decision
**Author:** Senior Product Engineer
**Scope:** `cloud/` (Cloudflare Worker + D1 + Pages)

---

## 1. Problem & context

An indie dev (@kedytcom) is publicly running an App Store *localization* experiment — "how far localization alone can take an indie app." His stack is TryAstro (ASO/localization data) + Argent + Fastlane (screenshots). This is a concrete, public demand signal for the exact surface ShipASO half-owns today.

**What we have today (grounded in the code):**

- We recommend *which* locales to expand into. `recommendLocales()` in `cloud/src/engine/localizationExpansion.ts:194` returns an ROI-sorted, saturation-aware list from a **static, bundled heuristic** (`locales-data.json`) — honest, no fabricated install data (see the honesty preamble at `localizationExpansion.ts:12-23`). It is wired into the keyed run at `cloud/src/api/index.ts:1016-1032` and rendered as the "Expand to more markets" card (`cloud/public/app.js:1400-1448`).
- We can read every live locale's copy: `readAscAllLocales()` at `cloud/src/engine/ascWrite.ts:681`.

**What's broken / missing — the gap between "recommend a locale" and "ship that locale":**

1. **No per-locale metadata generation.** `runAgent()` (`cloud/src/engine/agent.ts:222`) and `optimizeCopy()` (`cloud/src/engine/optimize.ts:237`) produce copy for **exactly one locale** (the `body.locale` of the run, default `en-US` — `cloud/src/api/index.ts:928`). The "Expand to more markets" card's primary button is honest about this: it routes to `#/apps/:id?asc=1` to re-run the *same single-locale* read-and-improve, with a comment admitting "a per-locale draft flow doesn't exist yet" (`cloud/public/app.js:1425-1430`). So we tell the user "claim es-MX" and then hand them nothing for es-MX.

2. **The handoff is single-locale.** `buildFastlaneBundle(copy, { locale })` (`cloud/src/engine/fastlane.ts:20`) writes ONE `fastlane/metadata/<locale>/` tree. The zip route (`cloud/src/api/index.ts:1371`) and PR route (`cloud/src/api/index.ts:1408`) call it with no locale → defaults to `en-US` (`fastlane.ts:6`). `applyAscMetadata()` / `ascPushRoute` push one locale (`cloud/src/api/index.ts:1535-1578`, `ascWrite.ts:217`).

3. **ASA data gap.** TryAstro's one real-data advantage is Apple Search Ads **popularity + difficulty** scores. We deliberately do **not** fabricate volume/difficulty (#65, closed — "stop presenting fabricated keyword metrics as measured data"). This is our integrity wedge, but it leaves a real feature gap.

4. **Screenshot localization absent.** We *score* live screenshots (`cloud/src/engine/screenshotScore.ts`, rendered `cloud/public/app.js:1100-1131`) and read them per locale from ASC, but we generate/deliver **zero** localized screenshots. The Fastlane bundle has no `screenshots/` path at all (`fastlane.ts` writes only `*.txt`).

**Why it matters:** TryAstro owns the cheap *data-dashboard* space at $9/mo. Our wedge is the **agent that ships** + **honesty**. Localization is the strongest concrete add-on to (a) reach parity on the dev's headline use case and (b) demonstrate the agent angle — *we draft the per-locale metadata and prepare the per-locale push; you approve.* Astro ships nothing.

---

## 2. Goal & non-goals

### Goal
Turn "recommend a locale" into "**draft + approval-gated ship** for that locale," extending the existing loop without compromising the honesty/credential posture.

**G1 — Per-locale metadata generation (highest signal).** For a keyed run, generate name/subtitle/keywords/promo for each recommended (or selected) target locale by translating + ASO-adapting the approved en-US copy, with explicit, honest provenance (translated, not measured-in-market).

**G2 — Per-locale approval-gated handoff.** Extend the Fastlane bundle, zip, PR, and direct-push paths to carry **multiple** locale trees; each locale is independently visible in the diff and independently gated by the single run approval. The agent never auto-pushes.

**G3 — ASA data gap: decision + honest fallback.** Spike whether Apple Search Ads popularity is obtainable **honestly** (real ASA account / documented API). If not, hold the #65 stance and lean on the agent/loop differentiation — **never** fabricate volume/difficulty. (This needs an owner DECISION — see §8.)

**G4 — Screenshot localization (text-overlay tier).** Where screenshots are template/caption-driven, localize the **caption text** per locale and emit them into the Fastlane `screenshots/<locale>/` tree. Ties to #47 (render real screenshots, closed) and #68 (dup detection, open).

### Non-goals
- **No** fabricated ASA popularity/difficulty numbers, ever (#65). If ASA isn't honestly obtainable, G3 ships as a documented "we don't guess" position, not a feature.
- **No** auto-push. Every per-locale write stays behind the existing run-approval gate + `ASC_WRITE_ENABLED` flag (`cloud/src/api/index.ts:1541`).
- **No** persisting the `.p8`. Same ephemeral-credential posture as every existing ASC route (`cloud/src/api/index.ts:1482`, `:912`).
- **No** full image-generation pipeline for screenshots in this PRD (no re-rendering Argent-style design). G4 is **text/caption** localization only; pixel-design generation is a separate, larger effort.
- **No** machine-translation presented as "human-reviewed" or "market-tested." Provenance must say "machine-translated draft — review before shipping."

---

## 3. Proposed approach (grounded in real files/functions)

### 3.1 Per-locale metadata generation (G1)

**New pure engine module: `cloud/src/engine/localizeCopy.ts`.** A function that takes approved en-US `ProposedCopy` (the type from `optimize.ts:227`) + a target locale + an optional `Reasoner` (the `env.AI`-backed translator) and returns a per-locale `ProposedCopy`, re-validated against the **same hard char limits** the single-locale optimizer enforces (`validateCopy` / `optimizeCopy`, `optimize.ts:77`, `:237`).

```
localizeCopy(
  base: ProposedCopy,
  target: { locale: string },
  translator?: Translator,   // prompt → translated text; built over env.AI
): Promise<LocalizedCopy>
```

Design rules, carried from the existing honesty disciplines:
- **Char limits are re-enforced post-translation.** Translated subtitle/keyword fields routinely overflow Apple's 30/30/100 budgets (German/Finnish expand badly). Run the translated field back through `validateCopy()`/the trimming logic in `optimize.ts` so we never emit an over-limit field. Dropped terms surface like the existing `droppedKeywords` note (`optimize.ts` `OptimizationNotes`).
- **Deterministic fallback.** Mirror `runKeywordReasoning()` (`keywordReasoner.ts:372`): when no translator binding exists or it errors/returns garbage, **do not invent a translation** — emit the locale as "needs translation" (effort `new`/`translate` already modeled in `localizationExpansion.ts:37`) rather than shipping English copy mislabeled as localized.
- **Provenance is explicit.** Each `LocalizedCopy` carries `source: "machine-translated"` so the UI and the Fastlane README can label it honestly. This is the localization analogue of the #65 "don't present generated as measured" rule.

**Translator binding: `cloud/src/api/aiTranslator.ts`** (new, sibling to `cloud/src/api/aiReasoner.ts`). Returns a `Translator` from `env.AI` (currently `@cf/meta/llama-3.1-8b-instruct`, `aiReasoner.ts:15`) or `undefined` when unbound — identical pattern to `reasonerForEnv()` (`aiReasoner.ts:39`). **DECISION flag in §8:** Llama-3.1-8b translation quality is materially below DeepL (Astro's engine). Either accept lower-quality MT with a loud "review before shipping" banner, or add an opt-in `DEEPL_API_KEY` env var and route through it when present. Engine stays binding-agnostic; only `aiTranslator.ts` touches the provider.

**Wiring:** in `runAppWithAsc` (`cloud/src/api/index.ts:917`), after computing `result.localizationExpansion` (`:1027`), for each recommended locale (capped, e.g. top 3) call `localizeCopy(result.proposedCopy, ...)` and attach `result.localizedCopy: Record<locale, LocalizedCopy>`. Persist on the trace (it's curated copy only — same privacy boundary as `proposedCopy`; the raw ASC snapshot still stays server-side, `:1033-1036`).

New `AgentResult.localizedCopy?` field (`cloud/src/engine/agent.ts:73-127`), optional so existing callers stay valid (the same pattern every PRD-NN field uses there).

### 3.2 Per-locale approval-gated handoff (G2)

**Extend `buildFastlaneBundle`** (`cloud/src/engine/fastlane.ts:20`) to accept either a single copy+locale (today) **or** `Record<locale, CopyFields>` and emit one `fastlane/metadata/<locale>/` tree per locale. The existing empty-field guard (`fastlane.ts:26-33`, the #29/#30 wipe-protection) is preserved per locale. The README (`fastlaneReadme`, `fastlane.ts:57`) gains a per-locale section and a line stating which locales are machine-translated drafts.

**Zip route** (`cloud/src/api/index.ts:1371`): build the multi-locale bundle from `trace.proposedCopy` + `trace.localizedCopy`. Still gated `status === "shipped" || "approved"` (`:1380`).

**PR route** (`cloud/src/api/index.ts:1408`): same multi-locale bundle into `openMetadataPr` (`githubPr.ts`). One PR, all locales, reviewable in `git diff` — the human approval is the merge.

**Direct push** (`ascPushRoute`, `cloud/src/api/index.ts:1535`): generalize to push **selected** locales. `applyAscMetadata` (`ascWrite.ts:217`) already takes a `locale`; loop it over the approved target locales, reusing `buildLocalizationPatch` (`ascWrite.ts:154`) whose non-empty-only guard (`ascWrite.ts:156-157`) already prevents blank-wipes per locale. Return `fieldsPushed` per locale. Still behind `ASC_WRITE_ENABLED` + run approval.

### 3.3 ASA data gap (G3)

**Spike only in this PRD** (no production feature without the §8 decision):
- Investigate the Apple Search Ads API (requires the user's own ASA account + org-level credential, distinct from the `.p8` ASC key). Document feasibility, auth model, and whether popularity/difficulty are exposed honestly per-keyword.
- If obtainable: feed real ASA popularity into the **existing** `rankOpportunity.ts` / `keywordGap.ts` winnability scoring as a *labeled, real* signal (never blended silently with heuristics — the #65 boundary).
- If not: ship a short honesty note in the UI/positioning ("we don't fabricate search volume; Astro shows ASA popularity, we show what the agent will *change*"). Relates to #63 (rank corpus moat — our real-data alternative is the cron-built corpus, not scraped ASA).

### 3.4 Screenshot localization (G4 — text-overlay tier)

- **New `cloud/src/engine/localizeShots.ts`**: given a base set of screenshot **captions** (the template text overlaid on the mockups, not the pixels) + target locales, translate each caption via the same `Translator`, with the same deterministic fallback. Output a `Record<locale, string[]>` of localized captions.
- **Fastlane delivery:** extend `buildFastlaneBundle` to optionally write `fastlane/screenshots/<locale>/` placeholders/captions, so the user's existing screenshot pipeline (they use Argent + Fastlane, per the issue) consumes them. We integrate Fastlane already (`fastlane.ts`).
- **Dup-awareness:** when #68 (near-duplicate screenshot detection) lands, skip localizing captions for slots we flag as wasted duplicates.
- This is **not** image generation; captions in, captions out. Pixel re-rendering is explicitly out of scope (Non-goals).

---

## 4. Exact files to change + new files

**New files**
- `cloud/src/engine/localizeCopy.ts` — pure per-locale copy generation (translate + re-enforce char limits + honest provenance).
- `cloud/src/engine/localizeCopy.spec.ts` — unit tests.
- `cloud/src/api/aiTranslator.ts` — `translatorForEnv(env)` over `env.AI` (and optional `DEEPL_API_KEY` if the §8 decision says so).
- `cloud/src/api/aiTranslator.spec.ts` — binding-present / binding-absent / provider-error tests.
- `cloud/src/engine/localizeShots.ts` — per-locale caption localization (G4).
- `cloud/src/engine/localizeShots.spec.ts` — unit tests.

**Changed files**
- `cloud/src/engine/agent.ts` — add `AgentResult.localizedCopy?` (and optionally `localizedShots?`) field (`:73-127`); optional, non-breaking.
- `cloud/src/engine/fastlane.ts` — multi-locale `buildFastlaneBundle`; per-locale README section; optional `screenshots/<locale>/` output (`:20`, `:57`).
- `cloud/src/engine/fastlane.spec.ts` — multi-locale cases; per-locale empty-field guard.
- `cloud/src/engine/ascWrite.ts` — only if push needs a thin multi-locale helper; `applyAscMetadata` (`:217`) and `buildLocalizationPatch` (`:154`) are already per-locale.
- `cloud/src/api/index.ts` — `runAppWithAsc` attaches `localizedCopy` (`:1027`+); `fastlaneZipRoute` (`:1371`), `githubPrRoute` (`:1408`), `ascPushRoute` (`:1535`) all consume multi-locale bundle / loop locales; new `localizedCopy` persisted on trace (mirrors `:281`).
- `cloud/src/index.ts` — add `DEEPL_API_KEY?` to `Env` **only if** the §8 decision chooses DeepL.
- `cloud/public/app.js` — replace the "Run with App Store Connect" honesty-stub button (`:1427-1430`) with a real per-locale draft view rendering `localizedCopy` (with a "machine-translated — review before shipping" banner); extend the run page diff to show per-locale before→proposed; add localized-caption preview.
- `cloud/src/api/aiReasoner.ts` — no change (reference pattern only).

**Mock parity**
- `cloud/public/mock.js` — add `localizedCopy` to a fixture run so the demo/offline mode renders the new card honestly.

---

## 5. Test plan (TDD, `*.spec.ts`, vitest — `cloud/package.json:10`)

Follow the repo convention: scaffold stub → failing test → implement. Colocated `*.spec.ts`, strong assertions, parameterized locales.

**Unit — `localizeCopy.spec.ts`**
- Translated subtitle that overflows 30 chars is trimmed to ≤30 (parameterize de-DE/fi-FI long expansions); dropped terms surfaced, never silently truncated.
- Keyword field stays ≤100 chars, comma-joined, no spaces (matches `optimize.ts` invariants).
- **No translator binding → returns a "needs translation" marker, never English copy mislabeled as localized** (the honesty assertion).
- Translator throws / returns unparseable → deterministic fallback, never throws (mirrors `keywordReasoner.spec.ts`).
- Provenance field is always `"machine-translated"` on a translated result.

**Unit — `aiTranslator.spec.ts`**
- Binding present → returns a `Translator`; absent → `undefined` (mirror `aiReasoner` tests).
- Provider error is swallowed at the engine boundary, surfaced as fallback.

**Unit — `fastlane.spec.ts` (extend)**
- Multi-locale input writes a `metadata/<locale>/` tree per locale; en-US unchanged from today.
- Per-locale empty-field guard: an empty translated subtitle for one locale emits **no** `subtitle.txt` for that locale (the #29/#30 wipe-protection holds per locale).
- README lists each locale and flags machine-translated ones.

**Unit — `localizeShots.spec.ts`**
- N captions × M locales → correct shape; no-binding fallback leaves captions untranslated and **flagged**, not silently English-as-localized.

**Integration / route-level (in `cloud/src/api/index.ts` test suites, following `runSerialize.spec.ts` / existing route specs)**
- `run-asc` attaches `localizedCopy` only when locales were read and a translator is available; absent otherwise (no empty/fabricated locales).
- `fastlane.zip` for a multi-locale approved run contains all locale trees; **403 before approval** (existing gate, `:1380`).
- `asc/push` loops selected locales, returns per-locale `fieldsPushed`; **403 when `ASC_WRITE_ENABLED` unset** (`:1541`) and when run not approved (`:1547`); blank field never patched per locale.

**Honesty regression tests (explicit)**
- A run with no translator binding produces **zero** localized copy rather than English-labeled-as-localized.
- `.p8` never appears in any persisted trace, log, or response for the multi-locale push (assert request body is not echoed).

**Gates before any commit:** `npm run lint && npm run typecheck && npm run test` in `cloud/` (per user workflow standards — quality gates required, no commit without explicit approval).

---

## 6. Honesty & security considerations

Honesty is this product's core value. Specific guardrails for this work:

1. **Never present machine translation as measured/market-validated.** Every localized field carries `source: "machine-translated"` and renders behind a "review before shipping" banner. This is the localization analogue of #65 (don't show generated data as measured). The static locale-value heuristic stays labeled "not live install data" (`localizationExpansion.ts:14-15`, `app.js:1443-1445`).
2. **Char limits re-enforced per locale** so we never emit a field that would be rejected or silently truncated by Apple — and dropped keywords are surfaced (the `optimize.ts` `droppedKeywords` discipline), never hidden.
3. **Never persist the `.p8`.** All per-locale ASC reads/writes reuse the existing in-request-only credential posture (`cloud/src/api/index.ts:912`, `:1482`, `:1532`); the `.p8` is minted to a short-lived JWT and never written to D1 or logs. New code touches only the JWT, never the `.p8` (same as `ascWrite.ts`).
4. **The agent NEVER auto-pushes.** Every per-locale write stays behind (a) the run-approval gate (`status` check, `:1380`/`:1547`) and (b) `ASC_WRITE_ENABLED` (`:1541`). The default path remains the credential-free Fastlane handoff the user's own CI executes (`fastlane.ts:8-18`). Multi-locale doesn't add a new auto-push surface.
5. **Wipe-protection holds per locale.** `buildLocalizationPatch` (`ascWrite.ts:156-157`) and the Fastlane empty-field guard (`fastlane.ts:31`) already omit empty fields; the multi-locale generalization must preserve this so one locale's thin translation can't blank another locale's live metadata.
6. **ASA:** no fabricated popularity/difficulty under any circumstance. Real ASA only if the spike proves an honest, account-backed path; otherwise ship the honesty position, not a guess.
7. **Privacy boundary intact.** `localizedCopy` is curated copy only (like `proposedCopy`) and is safe past the client boundary; the raw ASC snapshot stays server-side (`:1033-1036`).

---

## 7. Risks & rollout

| Risk | Mitigation |
|---|---|
| **MT quality (Llama-3.1-8b ≪ DeepL).** Bad German/Japanese ASO copy could regress a listing. | Loud "machine-translated draft — review before shipping" banner; char-limit re-enforcement; default handoff is review-gated (PR diff / Fastlane), so a human sees every locale before it ships. Optional DeepL via env (§8 decision). |
| Translated fields overflow char budgets. | Re-run through `validateCopy`/trim; surface dropped terms. Covered by tests. |
| Multi-locale push partially fails (locale 3 of 5 errors). | Per-locale `fieldsPushed` result; one locale's failure doesn't roll back others; surface per-locale status. Reuse `AscWriteError` token-free messages (`ascWrite.ts:735`). |
| Scope creep into image generation for G4. | Hard non-goal: captions only this PRD. |
| ASA spike yields nothing shippable. | Acceptable — it's a spike; fallback is the honesty position (already our wedge). |

**Rollout**
1. G1 + G2 behind the existing keyed-run path; localized copy only appears when `env.AI` (or DeepL) is bound — graceful degradation when unbound (same as the reasoner today).
2. Direct multi-locale push stays behind `ASC_WRITE_ENABLED` (default off). Fastlane/PR multi-locale handoff is the safe default and can ship first.
3. G3 is a spike → owner decision → conditional build.
4. G4 (caption localization) ships after G1's translator is proven, reusing it.

---

## 8. Effort estimate & required DECISION

**Effort: L overall**, decomposable:
- **G1 (per-locale metadata gen): M** — new pure module + translator binding + run-path wiring + tests. Reuses `optimize.ts` validation and the `reasonerForEnv` pattern.
- **G2 (multi-locale handoff): S–M** — `buildFastlaneBundle` generalization + 3 route updates; the per-locale primitives (`applyAscMetadata`, `buildLocalizationPatch`) already exist.
- **G3 (ASA): S spike**, then conditional (M if a real path exists).
- **G4 (screenshot caption localization): M** — new module + Fastlane delivery + UI; depends on G1's translator and ideally #68.

**Needs an owner DECISION before building:**
1. **Translation provider.** Accept Workers-AI (`@cf/meta/llama-3.1-8b-instruct`) MT with a strong "review" banner, **or** add opt-in `DEEPL_API_KEY` for parity with Astro's engine? This affects quality, cost, and a new `Env` secret. (Recommendation: ship G1 on Workers-AI behind the review banner first; add DeepL as an opt-in upgrade — keeps the honesty banner regardless.)
2. **ASA stance.** Authorize the ASA spike, and pre-agree the fallback: if popularity isn't honestly obtainable, we publicly keep the #65 "we don't fabricate volume" position rather than approximate it. (Recommendation: yes to spike, yes to honest-fallback — it *is* our differentiation.)
3. **G4 ceiling.** Confirm caption-only localization is the right first tier (vs investing in pixel/design generation later). (Recommendation: captions-only now.)

G2 (multi-locale Fastlane/PR handoff) is the lowest-risk, highest-honesty slice and can proceed without a provider decision if it ships only locales the user has already translated — but its value compounds with G1, which is gated on decision #1.

