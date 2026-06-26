# PRD — Name optimization: suggest a high-value word to fill unused title characters (#59)

> Status: **Ready to build** — the hard dependency (#57 keyword targeting) has landed. One product DECISION is required before implementation (see §8).

---

## 1. Problem & context

The app **name (title)** is the strongest ranking surface Apple indexes (the product's own copy says so repeatedly — e.g. `metadataCoverage.ts:5`, `keywordReasoner.ts:91`). It is hard-capped at 30 characters (`CHAR_LIMITS.name = 30`, `cloud/src/engine/constants.ts:10`).

Today the agent **never touches the name**. In `optimizeCopy` the name is passed straight through `fitToLimit` — it's only ever *truncated to fit*, never extended:

```
cloud/src/engine/optimize.ts:254
const name = fitToLimit(base.name || (primary[0] ?? ""), "name");
```

So an app like **"Mangia - Recipe Manager"** (23/30 chars) leaves **7 high-value characters unused**, and nothing in the loop proposes filling them. The coverage engine *correctly* refuses to call this "waste" — unused space is low usage, not low quality (`metadataCoverage.ts:18-20`, `:228-236`) — and the run page surfaces the name's fill bar (`app.js:1268-1272`) but offers **no suggestion** for what to put there. The user sees "you're using 23 of your name's chars" with no next action.

**Why it matters:** filling the title with a genuinely-searched, relevant term is the single highest-leverage ASO move available, and the agent already computes the exact inputs needed to do it honestly — it just doesn't connect them to the name field.

**Why it was blocked (now unblocked):** the issue says this must wait for the keyword-targeting AI work so the agent doesn't suggest junk (it previously surfaced the generic title token *"manager"*). That work is **#57, and it has landed**:
- `cloud/src/engine/keywordReasoner.ts` — "LLM classifies, reality validates": derives `target` keywords from the app **description**, guardrailed against invention (`isSubstantiated`, `:112-118`), with brand words and generic stopwords like `"manager"` forced out of the target lane (`STOP`, `:67-71`; `isStopTerm`, `:73-77`; guardrail at `:297-300`).
- `cloud/src/api/aiReasoner.ts` — the concrete `env.AI` (`@cf/meta/llama-3.1-8b-instruct`) reasoner, wired into both run paths (`api/index.ts:874-875`, `:985-986`).
- `cloud/src/api/runConfig.ts:178-209` (`reasonedKeywords`) turns those targets into the run's `keywords`, which become `result.reasoning: ScoredKeyword[]` (bucketed by `bucketize`, `agent.ts:250`).

So the agent now genuinely understands the app (recipe / meal planning / pantry / grocery for Mangia). The dependency's whole point — *only suggest a real, searched, relevant fill term* — is satisfiable from data we already hold.

---

## 2. Goal & non-goals

**Goal:** When a name has meaningful unused budget AND the loop has a high-value, relevant, **compliant** target term that would fit, produce a single honest **suggestion** (not an auto-applied change) to fill the title — e.g. *"Mangia - Recipe Manager"* → suggest leading/appending a searched term like *"Meal Planner"*. Surface it on the run page next to the existing name fill bar, and (if approved by the owner, §8) thread it into the proposed-copy diff.

**Non-goals:**
- **No auto-rewrite of the human's title.** The agent proposes; the human approves. Never silently overwrite the name (same posture as the subtitle `preserved` rule, `optimize.ts:215-225`).
- **No filler-for-filler's-sake.** If there is no genuinely-searched relevant term that fits, emit **nothing** (issue Honesty bullet 1).
- **No new ASC read or network call.** Pure derivation off data the run already holds (mirrors `coverageForRun`, `api/index.ts:293-306`).
- **No keyword-field rule violation.** Apple forbids the keyword field sharing words with the title/subtitle; the validator already enforces this (`optimize.ts:103-108`). Adding a word to the title must not orphan/duplicate a keyword-field term (issue Honesty bullet 2).
- **Not Google Play.** Scope is the App Store 30-char name only (Play has no keyword field; `agent.ts:209`).
- **No fabricated metrics.** We do not invent volume/relevance to justify a fill; we reuse the existing honest proxies (`runConfig.ts:154-167`).

---

## 3. Proposed approach (grounded in real files)

A new **pure, deterministic, network-free engine function** — `suggestNameFill` — that mirrors the established pattern of `metadataCoverage` / `findKeywordGaps` (pure engine + injected scorer + computed in the API run path, never in the engine).

### 3.1 Inputs (all already in scope at the call site)
- `name` — the live/current name (`result.currentCopy.name`, `agent.ts:259-269`).
- `targets` — the reasoned, **already-guardrailed** target terms. Best source is the run's bucketed `reasoning` (`AgentResult.reasoning: ScoredKeyword[]`, `agent.ts:73,250`) ordered by bucket (Primary → Secondary → Long-tail) — these are description-substantiated and brand/junk-free by construction (#57). We pass `keyword` + `bucket` + `score`.
- `banned` — words already in name + subtitle + keyword field, so a fill never duplicates an existing surface. Reuse the exact word-set logic the optimizer/validator already use (`optimize.ts:62-71` `words()`; the keyword-field collision rule `:103-108`).
- `brand` — first name token (same derivation as `coverageForRun`, `api/index.ts:297`), so we never suggest re-stuffing the brand word.

### 3.2 Algorithm (deterministic)
1. **Budget gate.** `remaining = 30 - name.length`. Require a minimum headroom (DECISION: default `>= 5`, see §8) — below that there's no room for a real term + separator. If insufficient → return `null`.
2. **Candidate filter.** From `targets`, drop any term that: is a brand word; shares any word with the name/subtitle/keyword field (`banned`); is a stopword/generic title token (already excluded upstream by #57, but re-assert defensively via the same `STOP`/`isStopTerm` discipline as `keywordReasoner.ts:67-77`); or whose **fit cost** (`term.length + separator/space`) exceeds `remaining`.
3. **Rank.** Order surviving candidates by the existing score (Primary bucket first, then `ScoredKeyword.score` desc, alphabetical tiebreak for determinism — same tiebreak shape as `keywordGap.ts:158-163`).
4. **Compose the suggested name.** Two honest placements, pick the one that fits and reads naturally:
   - **Append after the brand separator** (preferred): `"Mangia - Recipe Manager"` already has a descriptor tail; append `", Meal Planner"`-style only if it fits the 30 cap — reuse `fitToLimit("name")` (`optimize.ts:155-162`) to *guarantee* ≤30 (we NEVER emit over-limit, `optimize.ts:8-9`).
   - If no separator exists (all-brand title, `keywordReasoner.ts:95-98`), suggest a `"<Brand> – <Term>"` form.
5. **Compliance re-check.** Run the candidate name through `validateCopy` semantics: the new title word must NOT now collide with an existing keyword-field term. If it does, either (a) note that the keyword-field term should move (advisory), or (b) skip the candidate. Default: **skip** (conservative; the human's keyword field is real curated data, #75 / `runConfig.ts:186-194`).
6. **Output.** A typed `NameFillSuggestion | null`:

```ts
export type NameFillSuggestion = {
  term: string;            // the fill term, e.g. "meal planner"
  suggestedName: string;   // the full proposed ≤30-char name (validated, never over-limit)
  unusedChars: number;     // 30 - name.length (the opportunity size)
  reason: string;          // honest copy: "a searched, description-derived term that fits your 7 unused title chars"
  bucket: "Primary" | "Secondary" | "Long-tail";
};
```

### 3.3 Wiring (API run path only — never the engine)
Compute alongside coverage in **both** run paths, off data already in hand:
- `api/index.ts:894` (no-key `runApp`) and `:1015` (`runAppWithAsc`), immediately after `coverageForRun`.
- Add a sibling helper `nameFillForRun(currentCopy, reasoning, brand)` (mirrors `coverageForRun`, `:293-306`).
- Attach to `AgentResult` as an optional field `nameFill?: NameFillSuggestion` (mirrors how `coverage?`, `keywordGaps?` ride the trace, `agent.ts:112-119`). It serializes to the client via the same trace path (`api/index.ts:258` / `runSerialize`).

**Honesty default:** suggestion-only. Whether it also feeds `proposedCopy.name` / the PR-style diff is the §8 DECISION. Recommended default for v1: **surface-only**, do not mutate `proposedCopy.name` (keeps the no-regression posture of `optimize.ts` intact and avoids auto-rewriting the human's title).

### 3.4 UI
Render inside the existing coverage card, attached to the **name** fill row (`app.js:1268-1272`) or just below `coverageSection` (`:1276-1373`). When `cov` shows the name has empty/unused budget (`:1322-1330` already computes `emptySurfaces` / unused-name framing), and `nameFill` is present, render a single actionable line:

> *"7 unused title chars. Consider leading with **Meal Planner** — a searched, relevant term from your description. Your call; we won't change your title without approval."*

If `nameFill` is `null`, render **nothing** new (no "we couldn't find one" noise). Reuse the existing `faint` / `cov-note` styling; no new design system work.

---

## 4. Exact files to change + new files

**New:**
- `cloud/src/engine/nameFill.ts` — pure `suggestNameFill(input): NameFillSuggestion | null` + the `NameFillSuggestion` type. Imports `CHAR_LIMITS` (`constants.js`), reuses `words()`/`fitToLimit()` discipline from `optimize.ts` (extract/share if cleaner, else re-implement the tiny `words()` locally to keep the engine module self-contained, matching how `keywordReasoner.ts` has its own `words`).
- `cloud/src/engine/nameFill.spec.ts` — colocated unit tests (`*.spec.ts`, repo convention).

**Changed:**
- `cloud/src/engine/agent.ts` — add `nameFill?: NameFillSuggestion | undefined` to `AgentResult` (near `coverage?`, `:112-119`). (Engine type only; compute stays in API, like coverage.)
- `cloud/src/api/index.ts` — add `nameFillForRun(...)` helper (next to `coverageForRun`, `:293-306`); call it after `coverageForRun` at `:894` and `:1015`; ensure `nameFill` is included in the serialized trace (`buildRunResponse`/`runSerialize` around `:258-284`).
- `cloud/src/api/runSerialize.ts` (+ `runSerialize.spec.ts`) — include `nameFill` in the curated client payload (PII-safe: it's just a term + composed name + counts).
- `cloud/public/app.js` — render the suggestion in/under `coverageSection` (`:1276-1373`), gated on `nameFill` being present.
- `docs/prd/ranking-features/` — add `07-name-fill.md` (optional, matches the suite's PRD-per-feature convention).

**Tests touched:** `cloud/src/engine/agent.spec.ts` (assert `nameFill` rides the result when targets fit), `cloud/src/api/runSerialize.spec.ts` (serialization shape).

---

## 5. Test plan (TDD, `*.spec.ts`, strong assertions, parameterized)

Follow the repo's TDD order: scaffold stub → failing test → implement. Engine logic is pure ⇒ same input → deep-equal output (the discipline stated in `metadataCoverage.ts:24`).

**Unit — `cloud/src/engine/nameFill.spec.ts`:**
1. *Mangia golden path*: name `"Mangia - Recipe Manager"` (23 chars), targets include `"meal planner"` → returns a suggestion whose `suggestedName.length <= 30`, `term === "meal planner"`, `unusedChars === 7`.
2. *No headroom*: a 28–30-char name → returns `null` (budget gate).
3. *Never over-limit*: assert `suggestedName.length <= CHAR_LIMITS.name` across a parameterized table of names/terms (the over-limit guarantee, `optimize.ts:8-9`).
4. *Brand never suggested*: brand word in targets → excluded.
5. *Generic title token never suggested*: `"manager"`/`"tracker"` in targets → excluded (the exact failure the issue calls out).
6. *Keyword-field collision*: a target already in the keyword field → skipped (no Apple-rule violation; ties to `optimize.ts:103-108`).
7. *No valid candidate → `null`* (honesty: no filler-for-filler's-sake).
8. *Determinism*: same input twice → deep-equal; stable ordering/tiebreak.
9. *Separator vs all-brand* placement (parameterized: `"Mangia - Recipe Manager"` vs `"Pantry Pro"`).
10. *Multi-word fit cost* accounts for the separator/space, not just `term.length`.

**Integration — `agent.spec.ts` / `runSerialize.spec.ts`:** with reasoned targets that fit, `result.nameFill` is populated and survives serialization; with none, it's absent/`null` (no fabricated field).

**E2E / run-page:** if the repo has a Playwright/DOM harness for the run page, assert the suggestion line renders when `nameFill` is present and is **absent** when `null` (no empty-state noise). If no browser E2E exists, cover the render branch via the existing app.js test approach; do not stand up a new harness for this.

---

## 6. Honesty & security considerations (product's core value)

- **Never present unseen data as measured.** The suggestion is built only from terms the loop already derived honestly (#57 description-substantiated targets) and the *seen* name. On a no-key run we still only know the public name — that's fine, the name is public. We never imply the fill is "proven to rank"; copy frames it as "a searched, relevant term," consistent with the coverage honesty frame (`metadataCoverage.ts:13-17`, `app.js:1311`/`:1335`).
- **No `.p8` persistence.** This feature touches **no** credentials. It runs after the ephemeral ASC read in `runAppWithAsc` and uses only already-derived copy; the `.p8`/key/issuer remain ephemeral exactly as today (`api/index.ts:908-914`, `:975-984`). Do not add any new credential surface.
- **Agent NEVER auto-pushes.** Output is a **suggestion**, surfaced behind the existing approval gate (`runApp` persists `status: "awaiting_approval"`, `api/index.ts:897`). Default v1 does **not** even mutate `proposedCopy.name`; if §8 approves threading it into the diff, it still only ever appears as a *proposed* change a human approves — push commands stay non-executed handoffs (`agent.ts:5-9`, `:184-215`).
- **Apple compliance.** The composed name is run through `fitToLimit("name")` (≤30 guaranteed) and checked for keyword-field word collisions before emission (`optimize.ts:103-108`). No suggestion may create a title/keyword-field overlap.
- **Privacy boundary.** `nameFill` is curated copy (a term, a composed name, char counts) — no raw ASC data crosses the boundary, same as `coverage` (`api/index.ts:1012-1015`).
- **Input safety.** Targets already pass through `sanitizeKeywords` (`runConfig.ts:114-135`) before becoming `reasoning`, so the fill term inherits that sanitization; the run page renders text nodes only.

---

## 7. Risks & rollout

- **Risk: a "relevant" term still reads awkwardly in a human's brand title.** Mitigation: it's a *suggestion*, never auto-applied; copy is explicitly deferential ("your call"). Default v1 = surface-only.
- **Risk: reasoner returns weak/no targets (no AI binding, deterministic fallback).** Then candidates are thin or empty → we correctly return `null` and show nothing. Graceful by construction (mirrors `reasonKeywords` fallback, `keywordReasoner.ts:371-382`).
- **Risk: keyword-field collision logic drifts from the validator.** Mitigation: reuse the same `words()`/banned-set logic as `optimize.ts`; cover with test #6.
- **Risk: scope creep into auto-rewriting the title.** Hard-gated by the §8 DECISION and the surface-only default.
- **Rollout:** pure additive field + one UI line; no migration, no schema change (rides the existing `reasoning_json` trace). Ship behind the natural gate that it only renders when a real suggestion exists. Land engine + tests first (green), then API wiring, then UI — each independently reviewable.

---

## 8. Effort & decision

**Effort: S–M.** Engine function + tests is **S**. API wiring (two call sites, serialize) + one UI line pushes it to a small **M**. No new infra, no credentials, no network, no schema.

**Needs a product DECISION from the owner before building — two small calls:**
1. **Placement & application:** v1 **surface-only suggestion** (recommended), OR also thread the fill into `proposedCopy.name` / the PR-style diff? (Recommendation: surface-only first; it preserves the no-regression / no-auto-rewrite posture and is the safest honest default.)
2. **Minimum headroom threshold** to even offer a fill (recommended default `>= 5` unused chars; below that there's no room for a real term + separator). Tunable constant.

Everything else is settled by existing code and the issue's own constraints.

