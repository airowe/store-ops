# PRD — Rank intelligence T3: AI pattern-mining of change→move sequences (hypotheses, not proof)

GitHub issue: #64
Status: **Blocked on T2 (#63); requires an owner DECISION before building (see §8).**
Effort: **L** (large; largest/latest of the T1→T2→T3 arc).

---

## 1. Problem & context

ShipASO's whole credibility rests on one rule: **never present unseen data as measured, never make a causal claim.** The product already lives up to this in `cloud/src/engine/rankAttribution.ts:1-32` — for a *single app* it correlationally joins "a metadata push that ADDED term X" to "keyword X then moved," and it is rigorously labelled `linked` / `coincident` / `none` with a test that scans every emitted string for causal words (`cloud/src/engine/rankAttribution.spec.ts:223-228`).

What's missing is the **cross-app** version of that question. The paid incumbents (Sensor Tower / AppTweak / data.ai) can say "apps that added 'meal planner' to their title tended to climb for that term" because they scraped the store daily for years. ShipASO cannot. T2 (#63) is the plan to *start* accruing that corpus ourselves (a broad cross-app rank + visible-metadata time-series); **T3 (this issue) is the analysis layer on top of it** — feed the observed (visible-change → rank-move) sequences to an LLM reasoning step and surface *ranked, sample-sized, correlational hypotheses* about what visible moves preceded rank gains for a keyword/category.

This matters for two reasons:

1. **It feeds the keyword-targeting step (#57, now shipped in `cloud/src/engine/keywordReasoner.ts`).** Today that reasoner derives targets purely from *one* app's own description + name. T3 would let it answer "for the 'recipe' category, apps that added these visible terms tended to climb" — moving the targeting engine from single-app introspection to corpus-grounded guidance.
2. **It's the only honest path to a competitive moat.** We can't buy years of history; we can record it from now on (T2) and mine it (T3).

**Hard blocker:** T3 has nothing to analyze until T2 lands. A grep confirms **no corpus table or corpus collection exists yet** (`rank_corpus` / `category_corpus` / `corpus_snapshots` appear nowhere in `cloud/src` or `cloud/schema.sql`). The only cross-app visible-metadata we persist today is `competitor_snapshots` (name/version/rating only — `cloud/schema.sql:95-104`), scoped per customer app, which is far too thin to mine. So T3 must be specced against T2's *output contract*, and built behind a feature flag, defaulting off until the corpus is real.

---

## 2. Goal & non-goals

### Goal
Given the T2 corpus, produce **ranked correlational hypotheses** of the form:
> "Apps that added `'meal planner'` to a visible field tended to climb for `meal planner`. **Sample: 6 apps, 4 climbed, 2 flat/declined.** Examples: [app A: +14, app B: +9, …]. *This is a visible-only correlation, not a recommendation or a cause.*"

Each hypothesis must carry: the term/change observed, the keyword/category it correlates with, **sample size**, the actual supporting examples (app + observed move), a direction breakdown, and the standing honesty caveats. Surface as a read-only "what tends to work" panel, and expose the same data to the #57 targeting step as *advisory* signal.

### Non-goals
- **No causal claims, ever.** Output is correlational hypotheses, full stop (mirrors `rankAttribution.ts:17-28`).
- **No subtitle/keyword-field mining.** We only see name/version/rating/screenshots-text level visible data (same blind spot as #30/#41/#62). Patterns are inherently partial and must say so.
- **No auto-action.** T3 never changes a target, never opens a run, never pushes. It is pure read + display + advisory input. The agent NEVER auto-pushes (unchanged).
- **No new external data source.** T3 consumes the T2 corpus only; it does not scrape.
- **Not real-time.** Hypotheses are recomputed on a schedule / on demand, cached — not on every page load.
- **No statistical significance theatre.** We will NOT print p-values / confidence intervals that imply rigor the sample can't support. Sample size + raw examples, shown honestly, is the bar.

---

## 3. Proposed approach (grounded in real files)

T3 reuses the exact architecture pattern #57 already established: **pure engine module (provider-agnostic, fully unit-testable) + an injected `env.AI`-backed reasoner in the API layer + hard guardrails that reconcile the model's output against the real corpus data.** This is the proven, honesty-preserving shape in this codebase.

### 3.1 Stage A — deterministic sequence extraction (pure, no LLM)
A new pure engine module `cloud/src/engine/patternMiner.ts` takes the T2 corpus rows and **deterministically** builds (visibleChange → rankMove) observations *before* any LLM touches them. This is the load-bearing honesty layer — sample sizes and examples are computed from data, never from the model.

This reuses the proven primitives in `rankAttribution.ts`:
- The `addedTermsOf` / `pushCoversKeyword` word-diff logic (`rankAttribution.ts:116-144`) — already factors "what visible terms were ADDED between two snapshots, not reordered." We lift the pure helpers (`splitKeywordField`, `phraseWords`, `addedTermsOf`, `pushCoversKeyword`) into a shared `cloud/src/engine/visibleDiff.ts` and import them in both `rankAttribution.ts` and `patternMiner.ts` (DRY; no behavior change to the existing module).
- The `classify` direction logic (`rankAttribution.ts:198-209`) — "lower rank number is better → negative delta = improved" — is reused to label each move `up`/`down`/`new`/`lost`/`same`.

Stage A output: for each (added-visible-term, keyword) pair seen in the corpus, an aggregate `PatternObservation` — `{ term, keyword, category, sampleSize, climbed, flat, declined, examples: [{appRef, from, to, delta, observedAt}] }`. **Examples reference apps by an opaque corpus id, not a raw listing** (privacy boundary, mirrors `warRoom`'s "only name + rank numbers reach the client" rule at `api/index.ts:1198`).

### 3.2 Stage B — LLM ranking & phrasing (injected reasoner, guardrailed)
The LLM's ONLY job is to **rank and phrase** the already-computed observations — it never produces a number or an example. It receives the Stage-A `PatternObservation[]` and returns an ordering + a correlational sentence per pattern. We then **reconcile**: any sentence containing a causal/imperative word, or any sample size / example the model altered, is rejected and we fall back to a deterministic template string.

Reuses #57's machinery verbatim:
- `reasonerForEnv(env.AI)` (`cloud/src/api/aiReasoner.ts:39-55`) — the single place that touches the Workers AI binding (`@cf/meta/llama-3.1-8b-instruct`). T3 calls the same factory.
- The orchestrator/fallback pattern of `reasonKeywords` (`keywordReasoner.ts:371-382`): "on ANY error — reasoner throws, output unparseable, schema mismatch — fall back to deterministic. Never throws. When no reasoner is given, run deterministic-only." T3's `minePatterns(observations, reasoner?)` mirrors this exactly.
- The JSON-extraction + schema-validation guardrails (`extractJson` / `asModelShape` / `reconcileReasoning`, `keywordReasoner.ts:209-336`). T3 adds a **causal-word reconciler** identical in spirit to the honesty test at `rankAttribution.spec.ts:223-228`: every output string is scanned for `caused|because|drove|due to|led to|will rank|do this to|should add`, and on a hit the model sentence is discarded for the deterministic template.

### 3.3 Stage C — surfacing & feeding #57
- **Read endpoint** `GET /intel/patterns?keyword=…&category=…` added to the router in `cloud/src/api/index.ts:1769+` (alongside the existing `apps`/`runs`/`war-room` segments at `api/index.ts:1878-1912`). Returns cached Stage-A+B output. Owner-scoped, read-only, no DB writes, no outward pushes — same posture as `warRoom` (`api/index.ts:1201`).
- **UI panel** in `cloud/public/app.js` near the existing `rankMovementCard` (`public/app.js:703`) — a "What tends to work (correlational, visible-only)" card. Every pattern row shows the sample size and an expandable example list; an always-visible disclaimer states the visible-only + correlational limits.
- **#57 hand-off:** `keywordReasoner.ReasonerInputs` (`keywordReasoner.ts:38-42`) gains an optional `corpusHints?: PatternObservation[]`. When present, the prompt (`buildPrompt`, `keywordReasoner.ts:344-363`) appends them as *advisory, sample-sized correlations* — and the existing substantiation guardrail (`isSubstantiated`, `keywordReasoner.ts:112-118`) still binds, so a corpus hint can never invent a target the app's own text doesn't support. This is additive and behind the flag.

### 3.4 Recompute path (cron, never on request)
Pattern mining over the whole corpus is too heavy for a request. A scheduled recompute writes a cached `pattern_hypotheses` snapshot, following the existing cron shape in `cloud/src/cron/scheduled.ts:103-191` (`runWeeklySweep`). The endpoint reads the cache. The cron **only computes and caches** — it never pushes (the established cron invariant, `scheduled.ts:19-20`).

---

## 4. Exact files to change + new files

### New files
| File | Purpose |
|---|---|
| `cloud/src/engine/visibleDiff.ts` | Shared pure helpers extracted from `rankAttribution.ts` (`splitKeywordField`, `phraseWords`, `addedTermsOf`, `pushCoversKeyword`, `classify`). Zero behavior change. |
| `cloud/src/engine/visibleDiff.spec.ts` | Characterization tests pinning the extracted helpers (parity with current `rankAttribution.spec.ts` behavior). |
| `cloud/src/engine/patternMiner.ts` | **Pure, no D1/network.** Stage A (deterministic aggregation → `PatternObservation[]`) + Stage B orchestrator (`minePatterns(observations, reasoner?)`) + the causal-word reconciler + deterministic fallback templates. Provider-agnostic; injected `Reasoner` (`keywordReasoner.ts:36`). |
| `cloud/src/engine/patternMiner.spec.ts` | Unit tests (see §5). |
| `cloud/src/api/patternIntel.ts` | API glue: read T2 corpus from D1, call `minePatterns` with `reasonerForEnv(env.AI)`, shape the response. No raw listings leave here. |
| `cloud/src/api/patternIntel.spec.ts` | API-layer tests (D1 fixture + fake reasoner; owner-scope + privacy assertions). |

### Changed files
| File | Change |
|---|---|
| `cloud/src/engine/rankAttribution.ts` | Import the extracted helpers from `visibleDiff.ts` instead of defining them locally (`:88-209`). No external behavior change. |
| `cloud/src/api/index.ts` | Add `GET /intel/patterns` route in the router block (`:1769+`, next to `:1878-1912`); import `patternIntel`. |
| `cloud/src/d1.ts` | Add `getCorpusObservations(db, {keyword?, category?})` reader + `getPatternCache` / `putPatternCache` (mirrors the `getRankHistory` shape at `d1.ts:607-633`). **Reader contract defined by T2; until T2 lands, this reads the T2-specified table.** |
| `cloud/schema.sql` | Add `pattern_hypotheses` cache table (id, scope_key, computed_json, computed_at) + index — the *T2* corpus table itself is owned by #63, not this PR. Migration note inline (style of `schema.sql:134`). |
| `cloud/src/cron/scheduled.ts` | Add a `recomputePatterns(env)` pass invoked from `handleScheduled` (`:240-250`), behind the flag, writing the cache. Compute-only; never pushes. |
| `cloud/src/engine/keywordReasoner.ts` | `ReasonerInputs` gains optional `corpusHints`; `buildPrompt` appends them as advisory correlations (`:344-363`). Guardrails unchanged. |
| `cloud/public/app.js` | New "What tends to work" card near `rankMovementCard` (`:703`), with sample-size + examples + the visible-only/correlational disclaimer. |
| `cloud/wrangler.toml` | Add a `PATTERN_INTEL_ENABLED` env flag (off by default), parsed via the existing truthy-flag helper (`api/index.ts:1580`). |

---

## 5. Test plan (TDD, repo `*.spec.ts` convention, colocated)

Follow the repo's TDD loop (scaffold stub → failing test → implement) and the pure-vs-integration split. Engine specs run under the default `node` env (`vitest.config.ts`); API/cron specs use the Workers pool as noted in that config's comment.

### Unit — `patternMiner.spec.ts` (pure, no binding; mirrors `keywordReasoner.spec.ts`)
- **Deterministic Stage A:** given a fixture corpus where 4 of 6 apps that added `'meal planner'` climbed for `meal planner`, `sampleSize === 6`, `climbed === 4`, and `examples.length === 6` with correct `delta` signs (reuse the `classify` "negative = improved" convention). Parameterize the climbed/flat/declined counts — no unexplained literals.
- **Examples are real, not modelled:** the LLM is given a fake reasoner that *tries* to inflate `sampleSize` to 99 and invent an example app — assert the reconciled output keeps the Stage-A numbers and discards the model's.
- **Causal-word reconciler (the key honesty test, modeled on `rankAttribution.spec.ts:223-228`):** for a fake reasoner returning each of `caused`/`because`/`drove`/`due to`/`led to`/`will rank`/`do this to`/`should add`, assert the emitted hypothesis string contains **none** of them (falls back to the deterministic template).
- **Thin-data honesty:** a pattern backed by `sampleSize === 1` is either dropped or flagged `lowConfidence` and never phrased as guidance — assert no recommendation copy ("add", "you should") is emitted under threshold.
- **Fallback:** no reasoner → deterministic ordering + template strings; reasoner throws / returns garbage → identical deterministic output (mirrors `reasonKeywords` `keywordReasoner.ts:371-382`).
- **Visible-only caveat present** on every hypothesis payload.

### Unit — `visibleDiff.spec.ts`
- Characterization parity: the extracted `addedTermsOf` / `pushCoversKeyword` produce identical results to the pre-extraction `rankAttribution` behavior (reorders + pre-existing terms are NOT additions; multi-word keyword links only when all words added).

### Integration — `patternIntel.spec.ts` (D1 fixture + fake reasoner)
- Owner-scope: a non-owner / cross-tenant request to `/intel/patterns` is rejected (same `requireOwnedApp` posture used across `api/index.ts`).
- **Privacy:** the response contains opaque corpus ids + rank numbers only — assert no raw competitor listing fields leak (mirrors `warRoom` privacy note `api/index.ts:1198`).
- Cache read path returns the stored snapshot; flag-off returns an empty/disabled payload (no model call).
- **No writes / no push:** assert the handler performs no `INSERT`/`UPDATE` and triggers no outward push.

### Regression
- `rankAttribution.spec.ts` must stay green unchanged after the helper extraction (proves zero behavior drift).

### Quality gates (per user standards): run lint, typecheck, and full `vitest` before any commit. TypeScript strict; `type` over `interface`; small composable pure functions over classes.

---

## 6. Honesty & security considerations (core product value)

- **Correlation only, never causation.** Hard-enforced by the causal-word reconciler + spec, identical in spirit to `rankAttribution.ts:17-28` and its honesty test. Copy is "apps that did X *tended to* climb," never "do X to rank."
- **Sample size + real examples always shown.** No confident recommendation from thin data; sub-threshold patterns are flagged low-confidence or dropped. The LLM can rank/phrase but **cannot fabricate a number or an example** — those come only from deterministic Stage A.
- **Visible-only is stated, every time.** We can't see subtitle/keyword-field/competitor copy (the #30/#41/#62 blind spot). Every hypothesis and the UI panel carry an explicit "visible changes only — patterns are partial" caveat.
- **No `.p8` involvement.** T3 never reads or persists the ASC private key — it operates purely on already-stored corpus + rank rows. (Confirmed the corpus path is iTunes-public-data only, per #63.) The existing repo rule — never persist the `.p8` — is untouched.
- **Agent never auto-pushes.** T3 is read/advisory only: no run opened, no target changed, no metadata pushed. The cron recompute is compute-and-cache only (`scheduled.ts:19-20`). The irreversible push stays behind human approval, unchanged.
- **Privacy boundary.** Only opaque corpus ids + rank numbers reach the client; no raw third-party listing is exposed (mirrors `warRoom` at `api/index.ts:1198`).
- **iTunes ToS / egress scale** is a *T2* concern (broad systematic collection), explicitly flagged in #63 — T3 inherits whatever corpus T2 produces and adds no new fetching.

---

## 7. Risks & rollout

| Risk | Mitigation |
|---|---|
| **No corpus exists** (hard blocker) | Build behind `PATTERN_INTEL_ENABLED=off`; spec against T2's output contract; ship the engine + tests first, wire the live reader when #63 lands. |
| **Thin/early corpus → noisy or empty patterns** | Sample-size threshold; show "not enough data yet" honestly rather than a weak hypothesis. Patterns improve as the corpus compounds (the whole T2 thesis). |
| **Survivorship / confounding bias** (apps that climbed may differ for unseen reasons — subtitle/keyword/seasonality) | This is *why* it's framed correlational + visible-only with examples shown. We never claim the visible change explains the move. |
| **LLM drift toward imperative/causal copy** | Causal-word reconciler + deterministic fallback; spec gate. Same proven pattern as #57. |
| **Recompute cost over a growing corpus** | Cron-scheduled + cached, never per-request; endpoint reads the cache. |
| **#57 corpus-hint coupling** | Additive + optional; existing `isSubstantiated` guardrail still binds so a hint can't inject an unsupported target. Behind the flag. |

**Rollout:** (1) Land `visibleDiff` extraction + regression-green `rankAttribution`. (2) Land `patternMiner` engine + specs (deterministic-only, no binding). (3) Land `patternIntel` API + cache table + flag (off). (4) After #63 ships the corpus, wire the live D1 reader + cron recompute, enable the flag for internal/dogfood first, validate honesty copy on real data, then expose the UI card. (5) Wire the #57 corpus-hint last, once patterns are trustworthy.

---

## 8. Effort & decision

**Effort: L.** Spans a new pure engine module, a shared-helper refactor, an API endpoint + cache table, a cron recompute pass, a UI card, and a #57 hand-off — plus it is gated on #63 (T2) existing. The issue itself scopes it "largest / latest. Post-corpus, post-PMF."

**Requires an owner DECISION before building — yes.** Open questions the owner must resolve first (consistent with the T2/#57 decision posture):
1. **Build now (engine + flag, dark) vs. wait for #63?** T3 is genuinely blocked on the corpus; the honest options are (a) build the deterministic engine + tests now against T2's contract behind a dark flag, or (b) defer entirely until #63 lands. Recommend (a) — it's low-risk and de-risks #63's integration.
2. **Corpus output contract.** T2 (#63) must define the corpus table/shape (it doesn't exist yet). T3's `getCorpusObservations` reader and `PatternObservation` type should be co-designed with #63 so they don't drift.
3. **Sample-size threshold** for showing a pattern at all (e.g. n≥5?) and the low-confidence cutoff — a product-honesty call.
4. **Should corpus hints feed #57 automatically, or stay a separate read-only panel** until proven? Recommend separate panel first; #57 coupling only after dogfooding confirms the hypotheses hold up.

