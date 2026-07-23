# Age-Rating Read Fix — Design

**Date:** 2026-07-23
**Status:** Approved (root cause confirmed against Apple's live docs; user decisions taken)
**Surface:** `cloud/src/engine/ascWrite.ts` (reader), `cloud/src/engine/auditFindings.ts` (finding), `cloud/src/engine/ascContext.ts` (consumer), + specs

## The bug

Every keyed run shows the audit finding **"Age rating not confirmed"** — regardless of the app. On a `READY_FOR_SALE` app (which necessarily HAS an approved rating) this is a false alarm.

## Root cause (confirmed against Apple's docs)

`readAscAgeRating` → `mapAgeRatingDeclaration` reads `attrs.ageRating` and `attrs.kindOfAgeRating` and runs the first through `normalizeAgeRating` (which only accepts `FOUR_PLUS`/`TWELVE_PLUS`/`SEVENTEEN_PLUS`/`EIGHTEEN_PLUS`).

**Apple's `AgeRatingDeclaration.Attributes` resource has NO `ageRating` attribute and NO `kindOfAgeRating` attribute.** (Verified: `developer.apple.com/.../ageratingdeclaration/attributes-data.dictionary`.) The resource returns:
- **content-descriptor answers** — ~13 string-enum fields (`violenceCartoonOrFantasy`, `alcoholTobaccoOrDrugUseOrReferences`, …) taking `NONE | INFREQUENT_OR_MILD | FREQUENT_OR_INTENSE | INFREQUENT | FREQUENT`, plus ~11 boolean fields (`gambling`, `messagingAndChat`, `userGeneratedContent`, …);
- **override** fields — `ageRatingOverrideV2` (enum `NONE | NINE_PLUS | THIRTEEN_PLUS | SIXTEEN_PLUS | SEVENTEEN_PLUS | UNRATED`), `koreaAgeRatingOverride`, and the **deprecated** `ageRatingOverride`.

Apple does **not** return a derived/computed rating bucket on this resource — it computes the displayed rating from the answers. So `attrs.ageRating` is **always `undefined`**, `normalizeAgeRating` always returns `undefined`, and the finding fires 100% of the time.

**Why it shipped:** the reader's spec fixture (`ascWrite.spec.ts:~686`) invented `ageRating: "TWELVE_PLUS"` and `kindOfAgeRating: "PEGI"` — attributes Apple never sends — so the test passed against a fabricated shape. The test codified the phantom.

Two secondary defects the docs surfaced:
- the accepted enum vocabulary (`FOUR_PLUS`…) is wrong even for the override (which uses `NINE_PLUS`/`THIRTEEN_PLUS`/`SIXTEEN_PLUS`);
- descriptor answers can be `INFREQUENT`/`FREQUENT`, not only `*_OR_*` — our `!== "NONE"` check already handles this, no change needed there.

## Approach (both fixes, per user)

We **cannot** report a derived rating bucket (Apple doesn't expose one), so the fix is: **read what Apple actually returns, and stop implying we can read a rating it doesn't give us.**

### 1. Reader — fix `AscAgeRatingResult` + parse to Apple's real schema

Replace the phantom fields:

```ts
export type AscAgeRatingResult = {
  /** True when a declaration resource exists for the app (a present declaration
   *  on a live app IS the age-rating confirmation, even though Apple returns no
   *  derived bucket here). */
  declared?: boolean;
  /** The developer/Korea override when set — the one real rating SIGNAL Apple
   *  returns on this resource. Correct enum. */
  override?: "NONE" | "NINE_PLUS" | "THIRTEEN_PLUS" | "SIXTEEN_PLUS" | "SEVENTEEN_PLUS" | "UNRATED" | undefined;
  koreaOverride?: string | undefined;
  /** Names of the declaration questions that came back "set" (non-NONE string,
   *  or truthy boolean) — unchanged behavior. */
  contentDescriptors?: string[] | undefined;
};
```

`mapAgeRatingDeclaration`:
- `declared: true` whenever it's mapping a real declaration object (the caller only calls it with a present declaration).
- `override` from `attrs.ageRatingOverrideV2` (falling back to deprecated `attrs.ageRatingOverride`), passed through a corrected `normalizeOverride` that accepts the V2 enum; `"NONE"` maps to `undefined` (no override).
- `contentDescriptors` unchanged (the existing loop is correct; update `AGE_RATING_META_KEYS` to the real meta keys: `ageRatingOverride`, `ageRatingOverrideV2`, `koreaAgeRatingOverride`, `kidsAgeBand`, `developerAgeRatingInfoUrl` — drop the phantom `ageRating`/`kindOfAgeRating`).

`readAscAgeRating` control flow (fetch appInfo → follow declaration → inlined-or-GET) is **unchanged** — only the mapping changes. An absent declaration still returns `{}` (→ `declared` falsy).

Delete `normalizeAgeRating` (phantom-only) and the `ageRating`/`kindOfAgeRating` result assignments.

### 2. Finding — `auditFindings.ts` `ageRatingFindings`

New behavior (info-level, low-signal, never a blocker):
- **Declaration present (`declared`):** emit **"Age rating declared"** (severity `good`), detail names the flagged content descriptors (human-friendly) and the override if set. This replaces the false "not confirmed" for the common case.
- **Declaration truly absent (`snapshot.ageRating` present but `!declared`, i.e. `{}`):** keep an honest **"Age rating not confirmed"** at `info` — but this now only fires when the declaration relationship genuinely wasn't there, not on every run.
- **No `ageRating` in the snapshot at all** (non-keyed / unread): emit nothing, as today.

### 3. Consumer — `ascContext.ts:73`

`snapshot.ageRating?.ageRating` no longer exists. Update to the real signal:
`ctx.ageRating = override` when an override is set, else omit (we have no bucket to report). The context field stays optional; when there's no override we simply don't populate it (honest — we don't fabricate a bucket).

## Honesty invariant

Strengthened, not weakened: we stop asserting an unreadable field, report only what Apple genuinely returns (declaration presence, descriptors, override), and the false blocker-adjacent "not confirmed" no longer fires on healthy apps. Nothing is fabricated; the derived bucket we can't get is simply not shown.

## Testing

- `ascWrite.spec.ts` — **correct the fabricated fixture**: remove `ageRating`/`kindOfAgeRating`; assert `declared === true`, `override` parsed from `ageRatingOverrideV2`, and `contentDescriptors` (unchanged). Add a case with a real `ageRatingOverrideV2: "SEVENTEEN_PLUS"` → `override: "SEVENTEEN_PLUS"`, and `NONE` → no override. Absent declaration → `{}` (`declared` falsy).
- `auditFindings.spec.ts` — declared → "Age rating declared" (good); genuinely-absent declaration → "Age rating not confirmed" (info); no snapshot → no finding. Update any existing assertion that expected the old always-fires "not confirmed".
- `ascContext.spec.ts` — override present → `ctx.ageRating` = override; no override → field absent. Update the old fixture that set `ageRating.ageRating`.
- `runSerialize.spec.ts` — update any age-rating fixture to the new shape.
- Full worker suite green; `tsc --noEmit` clean.

## Out of scope (YAGNI)

- Computing/deriving the numeric rating bucket from the descriptor answers (Apple's algorithm is not published; faking it would violate the honesty invariant).
- Writing/updating the age rating (this is read-only audit surface).
- The mobile app.
