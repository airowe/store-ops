# Age-Rating Read Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the reader so age-rating reads Apple's real schema (no phantom `ageRating` bucket), and turn the always-firing "Age rating not confirmed" finding into an honest "Age rating declared" for the common case.

**Architecture:** Reader (`ascWrite.ts`) → finding (`auditFindings.ts`) → context consumer (`ascContext.ts`), all coupled through the `AscAgeRatingResult` type. Fix the type + reader first (foundation), then the two consumers, then reconcile remaining spec fixtures. Confirmed root cause: Apple's `AgeRatingDeclaration` resource has NO `ageRating`/`kindOfAgeRating` attribute (verified against developer.apple.com), so `attrs.ageRating` is always undefined and the finding fires 100% of the time.

**Tech Stack:** TypeScript (strict), Vitest 2, Cloudflare Worker engine. Run all commands from `cloud/`.

## Global Constraints

- **Import extensions:** `.js` even from `.ts`. Test files are `*.spec.ts` (this is the Worker engine — its convention is `.spec.ts`, NOT `.test.ts`; match the existing files).
- **Honesty invariant (load-bearing):** never report a rating bucket Apple doesn't return. Report only: declaration presence (`declared`), the override (`ageRatingOverrideV2`), and content descriptors. When there's no override, omit the context field — never fabricate a bucket.
- **Apple's real `AgeRatingDeclaration.Attributes` (verified):** NO `ageRating`, NO `kindOfAgeRating`. Has: ~13 string-enum content-descriptor fields (`violenceCartoonOrFantasy`, `alcoholTobaccoOrDrugUseOrReferences`, … taking `NONE|INFREQUENT_OR_MILD|FREQUENT_OR_INTENSE|INFREQUENT|FREQUENT`), ~11 boolean fields, and override fields: `ageRatingOverrideV2` (enum `NONE|NINE_PLUS|THIRTEEN_PLUS|SIXTEEN_PLUS|SEVENTEEN_PLUS|UNRATED`), `koreaAgeRatingOverride`, deprecated `ageRatingOverride`, plus `kidsAgeBand`, `developerAgeRatingInfoUrl`.
- **Blast radius:** `attrs.ageRating`/`.kindOfAgeRating` are phantom (always undefined). `AscAgeRatingResult.ageRating` is consumed in `auditFindings.ts` (2×) and `ascContext.ts` (1×), and asserted in 4 spec files (`ascWrite.spec.ts`, `auditFindings.spec.ts`, `ascContext.spec.ts`, `runSerialize.spec.ts`). All must move to the new shape.
- No API/DB/write-path change. `tsc --noEmit` clean; full worker suite green.

---

## File Structure

- **Modify** `cloud/src/engine/ascWrite.ts` — `AscAgeRatingResult` type, `mapAgeRatingDeclaration`, `AGE_RATING_META_KEYS`; delete `normalizeAgeRating`, add `normalizeOverride`.
- **Modify** `cloud/src/engine/ascWrite.spec.ts` — correct the fabricated declaration fixture + assertions.
- **Modify** `cloud/src/engine/auditFindings.ts` — `ageRatingFindings`.
- **Modify** `cloud/src/engine/auditFindings.spec.ts` — the age-rating fixture + expected finding.
- **Modify** `cloud/src/engine/ascContext.ts` — the age-rating consumer (line ~73).
- **Modify** `cloud/src/engine/ascContext.spec.ts` — fixture + assertion.
- **Modify** `cloud/src/api/runSerialize.spec.ts` — fixture + assertion.

---

## Task 1: Reader — fix the type + parse to Apple's real schema

**Files:**
- Modify: `cloud/src/engine/ascWrite.ts`
- Test: `cloud/src/engine/ascWrite.spec.ts`

**Interfaces:**
- Produces (the new type other tasks consume):
  ```ts
  export type AscAgeRatingResult = {
    declared?: boolean;
    override?: "NONE" | "NINE_PLUS" | "THIRTEEN_PLUS" | "SIXTEEN_PLUS" | "SEVENTEEN_PLUS" | "UNRATED" | undefined;
    koreaOverride?: string | undefined;
    contentDescriptors?: string[] | undefined;
  };
  ```

- [ ] **Step 1: Update the failing test fixture + assertions**

In `cloud/src/engine/ascWrite.spec.ts`, the `declarationAttributes` fixture (~line 685) invents `ageRating`/`kindOfAgeRating` — Apple never returns those. Replace it and its assertions to match Apple's real schema. Change `declarationAttributes` to:

```ts
const declarationAttributes = {
  ageRatingOverrideV2: "SEVENTEEN_PLUS", // the real override signal Apple returns
  ageRatingOverride: "NONE",             // deprecated; ignored in favor of V2
  koreaAgeRatingOverride: "NONE",
  kidsAgeBand: null,
  developerAgeRatingInfoUrl: "https://example.com/rating",
  // content descriptor questions that came back set
  violenceCartoonOrFantasy: "INFREQUENT_OR_MILD",
  alcoholTobaccoOrDrugUseOrReferences: "FREQUENT_OR_INTENSE",
  gambling: false,
  horrorOrFearThemes: "NONE",
};
```

In the "returns the rating + descriptors when …" test, replace the `ageRating`/`kindOfAgeRating` assertions with:

```ts
const r = await readAscAgeRating(fetchFn, { token: "JWT", appId: "APP1" });
expect(r.declared).toBe(true);
expect(r.override).toBe("SEVENTEEN_PLUS");
// descriptors are the non-NONE / truthy declaration keys
expect(r.contentDescriptors).toContain("violenceCartoonOrFantasy");
expect(r.contentDescriptors).toContain("alcoholTobaccoOrDrugUseOrReferences");
expect(r.contentDescriptors).not.toContain("horrorOrFearThemes"); // NONE → excluded
expect(r.contentDescriptors).not.toContain("gambling"); // false → excluded
// override/meta keys are NOT descriptors
expect(r.contentDescriptors).not.toContain("ageRatingOverrideV2");
expect(r.contentDescriptors).not.toContain("developerAgeRatingInfoUrl");
expect(calls.some((u) => u.includes("/ageRatingDeclarations/"))).toBe(false);
```

In the "falls back to GET …" test, replace `expect(r.ageRating).toBe("TWELVE_PLUS")` with `expect(r.override).toBe("SEVENTEEN_PLUS")` and `expect(r.declared).toBe(true)`.

Add a new test for the no-override case (declared but unrated):

```ts
it("marks declared:true with no override when ageRatingOverrideV2 is NONE", async () => {
  const { fetchFn } = makeFetch([
    {
      match: "/appInfos?",
      body: {
        data: [{ id: "INFO1", type: "appInfos",
          relationships: { ageRatingDeclaration: { data: { id: "DECL1", type: "ageRatingDeclarations" } } } }],
        included: [{ id: "DECL1", type: "ageRatingDeclarations",
          attributes: { ageRatingOverrideV2: "NONE", violenceCartoonOrFantasy: "NONE" } }],
      },
    },
  ]);
  const r = await readAscAgeRating(fetchFn, { token: "JWT", appId: "APP1" });
  expect(r.declared).toBe(true);
  expect(r.override).toBeUndefined();
});
```

The "degrades to an empty result when there are no appInfos" test stays (`expect(r).toEqual({})`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud && node node_modules/.bin/vitest run src/engine/ascWrite.spec.ts`
Expected: FAIL — `r.declared`/`r.override` are undefined (code still reads phantom `ageRating`).

- [ ] **Step 3: Implement**

In `cloud/src/engine/ascWrite.ts`:

Replace the `AscAgeRatingResult` type (currently ~line 526) with:

```ts
export type AscAgeRatingResult = {
  /** True when a real age-rating declaration exists for the app. On a live
   *  (READY_FOR_SALE) app a present declaration IS the confirmation — Apple
   *  returns NO derived rating bucket on this resource. */
  declared?: boolean;
  /** The developer override when set — the only real rating SIGNAL Apple returns
   *  here (ageRatingOverrideV2). "NONE" is normalized to undefined. */
  override?: "NONE" | "NINE_PLUS" | "THIRTEEN_PLUS" | "SIXTEEN_PLUS" | "SEVENTEEN_PLUS" | "UNRATED" | undefined;
  /** Korea-specific override when present, passed through as a label. */
  koreaOverride?: string | undefined;
  /** Names of the declaration questions that came back set (non-NONE string,
   *  or truthy boolean), e.g. ["violenceCartoonOrFantasy"]. */
  contentDescriptors?: string[] | undefined;
};
```

Replace `normalizeAgeRating` with `normalizeOverride`:

```ts
/** A developer override bucket if Apple's ageRatingOverrideV2 is one we recognise
 *  and it's an actual override (not "NONE"), else undefined. */
function normalizeOverride(value: unknown): AscAgeRatingResult["override"] {
  return value === "NINE_PLUS" ||
    value === "THIRTEEN_PLUS" ||
    value === "SIXTEEN_PLUS" ||
    value === "SEVENTEEN_PLUS" ||
    value === "UNRATED"
    ? value
    : undefined; // "NONE" (or anything unrecognised) → no override
}
```

Update `AGE_RATING_META_KEYS` (the non-descriptor keys) to Apple's real meta fields:

```ts
const AGE_RATING_META_KEYS = new Set([
  "ageRatingOverride",
  "ageRatingOverrideV2",
  "koreaAgeRatingOverride",
  "kidsAgeBand",
  "developerAgeRatingInfoUrl",
]);
```

Rewrite `mapAgeRatingDeclaration`'s result assembly (keep the descriptor loop as-is):

```ts
export function mapAgeRatingDeclaration(decl: AgeRatingDeclaration | undefined): AscAgeRatingResult {
  const attrs = decl?.attributes ?? {};
  const descriptors: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (AGE_RATING_META_KEYS.has(key)) continue;
    const set = typeof value === "string" ? value !== "" && value !== "NONE" : value === true;
    if (set) descriptors.push(key);
  }
  const result: AscAgeRatingResult = { declared: true };
  const override = normalizeOverride(attrs.ageRatingOverrideV2 ?? attrs.ageRatingOverride);
  if (override) result.override = override;
  if (typeof attrs.koreaAgeRatingOverride === "string" && attrs.koreaAgeRatingOverride !== "" && attrs.koreaAgeRatingOverride !== "NONE") {
    result.koreaOverride = attrs.koreaAgeRatingOverride;
  }
  if (descriptors.length > 0) result.contentDescriptors = descriptors;
  return result;
}
```

`readAscAgeRating` is unchanged (it already returns `{}` for absent declarations and calls `mapAgeRatingDeclaration` when present).

- [ ] **Step 4: Run to verify it passes**

Run: `cd cloud && node node_modules/.bin/vitest run src/engine/ascWrite.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck** — `cd cloud && npx tsc --noEmit` → expect errors ONLY in the not-yet-updated consumers (auditFindings.ts, ascContext.ts) referencing `.ageRating`; those are fixed in Tasks 2–3. (If tsc is clean here, even better — but consumer errors are expected and acceptable at this step; do NOT edit consumers in this task.)

- [ ] **Step 6: Commit**

```bash
git add cloud/src/engine/ascWrite.ts cloud/src/engine/ascWrite.spec.ts
git commit -m "fix(asc): read age rating from Apple's real schema (override + declared, no phantom bucket)"
```

---

## Task 2: Finding — "Age rating declared" for the common case

**Files:**
- Modify: `cloud/src/engine/auditFindings.ts`
- Test: `cloud/src/engine/auditFindings.spec.ts`

**Interfaces:**
- Consumes (Task 1): `AscAgeRatingResult` with `declared`/`override`/`contentDescriptors`.

- [ ] **Step 1: Update the failing test**

This is a **table-driven spec**. Real helpers (verified): `healthySnapshot()` (builds the default snapshot, line ~49), `input(over?)` (line ~79), `ids(input)` → `auditFindings(input).map(f => f.id)` (line ~91), `byId(findings, id)` (line ~95). There's a findings table (array of `{ id, severity, impact, surface, trigger }`) that a driving `it()` iterates.

Two exact edits:

**(a)** The `healthySnapshot()` fixture (line ~69) currently has `ageRating: { ageRating: "FOUR_PLUS" }`. Change to a declared shape:
```ts
ageRating: { declared: true, contentDescriptors: ["violenceCartoonOrFantasy"] },
```

**(b)** The findings table currently has TWO age entries: one `id: "age_rating_unconfirmed"` whose `trigger` sets `snap.ageRating = {}` (line ~319), and one whose comment says `// declared in healthy` (line ~333). Update them so:
- the healthy/declared entry expects `id: "age_rating_declared"`, `severity: "good"`, `surface: "ageRating"`, `trigger: (b) => b` (healthy snapshot is now declared);
- the empty-case entry keeps `id: "age_rating_unconfirmed"`, `severity: "info"`, `surface: "ageRating"`, and its `trigger` that sets `snap.ageRating = {}`.

Match the exact object shape of the other table entries (with `impact: "completeness"`). If the driving `it()` asserts each entry's finding is present with its severity via `byId`, no extra test is needed — the two table rows cover declared-present (good) and genuinely-absent (info). Also add a direct assertion that declared does NOT also emit unconfirmed:
```ts
it("a declared age rating emits 'declared', never the false 'not confirmed'", () => {
  const got = ids(input()); // healthySnapshot is declared
  expect(got).toContain("age_rating_declared");
  expect(got).not.toContain("age_rating_unconfirmed");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud && node node_modules/.bin/vitest run src/engine/auditFindings.spec.ts`
Expected: FAIL (`age_rating_declared` not emitted yet).

- [ ] **Step 3: Implement**

Rewrite `ageRatingFindings` in `cloud/src/engine/auditFindings.ts`:

```ts
/** ageRating — from `snapshot.ageRating`. Low-signal: never above `info`/`good`.
 *  Apple returns no derived rating bucket, so a PRESENT declaration is itself the
 *  confirmation; only a genuinely-absent declaration reads "not confirmed". */
function ageRatingFindings(snapshot: AscSnapshot | undefined): Finding[] {
  const ageRating = snapshot?.ageRating;
  if (!ageRating) return []; // non-keyed / unread → say nothing

  if (ageRating.declared) {
    const descriptors = ageRating.contentDescriptors ?? [];
    const bits: string[] = [];
    if (ageRating.override) bits.push(`override ${ageRating.override.replace(/_/g, " ").toLowerCase()}`);
    if (descriptors.length > 0) bits.push(`${descriptors.length} content descriptor${descriptors.length === 1 ? "" : "s"} flagged`);
    return [
      mk({
        id: "age_rating_declared",
        surface: "ageRating",
        severity: "good",
        impact: "completeness",
        title: "Age rating declared",
        detail:
          "Your app has an age-rating declaration in App Store Connect" +
          (bits.length ? ` (${bits.join(", ")})` : "") +
          ". Apple computes the displayed rating from your declaration answers.",
        fix: "No action — context only.",
        ...(descriptors.length > 0 ? { evidence: descriptors.join(", ") } : {}),
        context: true,
      }),
    ];
  }

  // Declaration genuinely absent (readAscAgeRating returned {}). Honest, info-level,
  // never a blocker — a live app necessarily has a rating, so this is rare.
  return [
    mk({
      id: "age_rating_unconfirmed",
      surface: "ageRating",
      severity: "info",
      impact: "completeness",
      title: "Age rating not confirmed",
      detail: "We couldn't read an age-rating declaration from App Store Connect — that may be a read limitation, not a missing rating.",
      fix: "Confirm your age rating is set in App Store Connect (it's required to ship).",
    }),
  ];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd cloud && node node_modules/.bin/vitest run src/engine/auditFindings.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck** — `cd cloud && npx tsc --noEmit` → errors only from `ascContext.ts` now (fixed in Task 3).

- [ ] **Step 6: Commit**

```bash
git add cloud/src/engine/auditFindings.ts cloud/src/engine/auditFindings.spec.ts
git commit -m "fix(asc): emit 'Age rating declared' when a declaration exists, not a false 'not confirmed'"
```

---

## Task 3: Context consumer — report the override, not a phantom bucket

**Files:**
- Modify: `cloud/src/engine/ascContext.ts`
- Test: `cloud/src/engine/ascContext.spec.ts`

**Interfaces:**
- Consumes (Task 1): `AscAgeRatingResult`.

- [ ] **Step 1: Update the failing test**

Real helpers (verified): `buildAscContext(snapshot)` (the function under test), `richSnapshot()` (fixture builder, line ~14). The `richSnapshot()` fixture has `ageRating: { ageRating: "FOUR_PLUS" }` (line ~45), and the main test (line ~57) does `expect(ctx).toEqual({ … ageRating: "FOUR_PLUS", … })`.

Edits:
- **Fixture** (line ~45): `ageRating: { declared: true, override: "SEVENTEEN_PLUS" }`.
- **Assertion** (line ~61, inside the `toEqual`): change `ageRating: "FOUR_PLUS"` → `ageRating: "SEVENTEEN_PLUS"` (the override is now the reported value).
- If line ~111 references `"ageRating"` in a key-list (e.g. FORBIDDEN/allowed keys), leave it — the key name is unchanged.

Add a no-override test:
```ts
it("omits ageRating context when the declaration has no override (Apple returns no bucket)", () => {
  const snap = richSnapshot();
  snap.ageRating = { declared: true };
  const ctx = buildAscContext(snap);
  expect(ctx?.ageRating).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails** — `cd cloud && node node_modules/.bin/vitest run src/engine/ascContext.spec.ts` → FAIL.

- [ ] **Step 3: Implement**

In `cloud/src/engine/ascContext.ts` (~line 73), replace:

```ts
const ageRating = snapshot.ageRating?.ageRating;
if (ageRating) ctx.ageRating = ageRating;
```

with:

```ts
// Apple returns no derived bucket; the override is the only real rating value.
// No override → we have nothing to report, so omit (never fabricate a bucket).
const override = snapshot.ageRating?.override;
if (override) ctx.ageRating = override;
```

- [ ] **Step 4: Run to verify it passes** — `cd cloud && node node_modules/.bin/vitest run src/engine/ascContext.spec.ts` → PASS.

- [ ] **Step 5: Typecheck** — `cd cloud && npx tsc --noEmit` → No errors (all consumers now updated).

- [ ] **Step 6: Commit**

```bash
git add cloud/src/engine/ascContext.ts cloud/src/engine/ascContext.spec.ts
git commit -m "fix(asc): report the age-rating override in context, omit when Apple gives no bucket"
```

---

## Task 4: Reconcile runSerialize fixture + full gate

**Files:**
- Modify: `cloud/src/api/runSerialize.spec.ts`
- (verification for the rest)

- [ ] **Step 1: Update the runSerialize fixture**

In `cloud/src/api/runSerialize.spec.ts` (verified — same `buildAscContext` pattern): fixture (line ~53) `ageRating: { ageRating: "FOUR_PLUS" }` feeds the assertion (line ~149) inside `expect(result.ascContext).toEqual({ … ageRating: "FOUR_PLUS", … })`. Two exact edits:
- fixture (line ~53): `ageRating: { declared: true, override: "SEVENTEEN_PLUS" }`
- assertion (line ~149): `ageRating: "FOUR_PLUS"` → `ageRating: "SEVENTEEN_PLUS"` (the override is now the reported context value)

- [ ] **Step 2: Run the 4 age-rating specs together** — `cd cloud && node node_modules/.bin/vitest run src/engine/ascWrite.spec.ts src/engine/auditFindings.spec.ts src/engine/ascContext.spec.ts src/api/runSerialize.spec.ts` → all PASS.

- [ ] **Step 3: Full worker suite** — `cd cloud && node node_modules/.bin/vitest run` → all green (2007 baseline; net test count may shift by the added/removed age-rating cases).

- [ ] **Step 4: Typecheck** — `cd cloud && npx tsc --noEmit` → No errors.

- [ ] **Step 5: Commit**

```bash
git add cloud/src/api/runSerialize.spec.ts
git commit -m "test(asc): update runSerialize age-rating fixture to the real schema"
```

---

## Self-Review

- **Spec coverage:** reader type + parse (Task 1); false-finding → declared finding + honest absent case (Task 2); context consumer (Task 3); remaining fixture + gate (Task 4). All three source touch-points (`ascWrite`, `auditFindings`, `ascContext`) + all four spec files covered. ✅
- **Placeholder scan:** the consumer/finding test steps say "adapt to the file's real helper names" — that's necessary because the exact fixture-builder names weren't fully read; the implementer must inspect the spec file. Flagged explicitly, not a silent gap. All source code is complete and exact. ✅
- **Type consistency:** `AscAgeRatingResult` shape (`declared`/`override`/`koreaOverride`/`contentDescriptors`) defined in Task 1 and consumed identically in Tasks 2–3. The override enum matches Apple's `ageRatingOverrideV2` verbatim. `normalizeAgeRating` deleted, `normalizeOverride` added. ✅
- **Honesty:** no fabricated bucket anywhere — `declared`/`override`/descriptors only; context omitted when no override; finding says "declared" (present) vs "not confirmed" (genuinely absent). ✅
