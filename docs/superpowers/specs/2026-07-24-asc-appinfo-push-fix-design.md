# ASC Push — name/subtitle to the correct resource (appInfoLocalizations)

**Date:** 2026-07-24
**Status:** Approved for planning
**Type:** Bug fix (live-write defect)

## The bug

Pushing approved copy to App Store Connect fails with:

> App Store Connect rejected the update localization (409): `'name' is not an attribute on the resource 'appStoreVersionLocalizations'`

`applyAscMetadata` PATCHes ALL fields — including `name` and `subtitle` — onto `appStoreVersionLocalizations`. But Apple stores **`name` and `subtitle` on a different resource: `appInfoLocalizations`** (the app-level layer). Only `keywords`, `promotionalText`, `description`, `whatsNew` (and marketing/support URLs) belong on `appStoreVersionLocalizations`. Any push whose proposed copy changes `name` (or `subtitle`) is rejected outright.

## Root cause (confirmed in code)

- `cloud/src/engine/ascWrite.ts:154` `buildLocalizationPatch` sets `name`/`subtitle` on the version-localization PATCH (lines 159–160).
- The **read** path already handles the split correctly (`readAscLocalization` lines 312–345, `readAscAppInfo` reads name/subtitle from `appInfoLocalizations`). The write path was never brought into line.
- **A test codifies the bug:** `ascWrite.spec.ts` (~line 293) asserts the PATCH URL is `/appStoreVersionLocalizations/L_US` and the body contains `"name":"Calm"`. This test is wrong and must be corrected as part of the fix.

## The correct ASC contract

| Field | ASC resource | Endpoint (PATCH) |
|-------|--------------|------------------|
| `name`, `subtitle` | `appInfoLocalizations` | `/appInfoLocalizations/{id}` |
| `keywords`, `promo`→`promotionalText`, `description`, `whatsNew` | `appStoreVersionLocalizations` | `/appStoreVersionLocalizations/{id}` |

## Design

1. **Split the patch builders.**
   - `buildLocalizationPatch` (version localization) stops setting `name`/`subtitle` — it keeps only `keywords`, `promotionalText`, `description`, `whatsNew`. (The `LocalizationPatch` attributes type drops `name`/`subtitle`.)
   - New `buildAppInfoLocalizationPatch(appInfoLocalizationId, copy)` builds the `appInfoLocalizations` PATCH with `name`/`subtitle` only, same non-empty-only safety rule (never overwrite a live field with a blank).

2. **Expose the appInfoLocalization id.** `readAscAppInfo`'s `AppInfoResult.locales[]` gains `id: string` (the appInfoLocalization resource id), so the write path can resolve the PATCH target for the locale. (Read-only change to the shape; existing read tests updated to include the id.)

3. **Orchestrate two PATCHes in `applyAscMetadata`.**
   - Version-localization PATCH as today (now without name/subtitle).
   - If `name`/`subtitle` are present (non-empty), resolve the appInfoLocalization id for the locale (same base-language fallback the read path uses: exact locale → base language → first), then PATCH `/appInfoLocalizations/{id}`.
   - `fieldsPushed` merges the attributes actually PATCHed across BOTH resources.
   - **Honest partial failure:** if one PATCH succeeds and the other fails, the result must report exactly what landed and what didn't — never a silent half-write, never claim success for a field that was rejected. Preserve the existing "token never in the error" guarantee.
   - If ONLY name/subtitle changed (no version-localization fields), the version PATCH is skipped (nothing to send there) and only the appInfo PATCH runs — and vice-versa. The existing "nothing to push" guard fires only when BOTH are empty.

4. **`dryRun`** returns both would-be PATCH bodies (or the relevant one), so the existing dry-run path still shows the exact requests without writing.

## Honesty invariant

Unchanged and reinforced: the push result reports the true set of fields ASC accepted. A rejected field is never reported as pushed. Partial success is surfaced explicitly.

## Testing

Extend `cloud/src/engine/ascWrite.spec.ts` (vitest):

- **`buildLocalizationPatch`**: `name`/`subtitle` are NOT in the version patch; `keywords`/`promo`/`description`/`whatsNew` are; blanks still omitted. (Correct the existing test that expects `name` in the version patch.)
- **`buildAppInfoLocalizationPatch`**: `name`/`subtitle` ARE in the appInfo patch; blanks omitted; other fields never appear.
- **`readAscAppInfo`**: `locales[].id` is populated from the appInfoLocalization resource id. (Update existing appInfo read tests to assert the id.)
- **`applyAscMetadata`**:
  - a full push issues TWO PATCHes — `/appStoreVersionLocalizations/{id}` (keywords/desc/…) and `/appInfoLocalizations/{id}` (name/subtitle) — and `fieldsPushed` contains fields from both.
  - name-only change → only the appInfo PATCH; keywords-only change → only the version PATCH.
  - version PATCH ok + appInfo PATCH 409 → result reports the version fields as pushed and surfaces the appInfo failure (partial), token never leaked.
  - the reproduction case: a proposal that changes `name` no longer 409s (the version PATCH carries no `name`).
  - `dryRun` shows both bodies, no write.

## Scope

- Only `cloud/src/engine/ascWrite.ts` and its spec. The push handler in `cloud/src/api/index.ts` calls `applyAscMetadata` and consumes its result — verify it still compiles against the (possibly enriched) result shape; adjust only if the result type changed in a breaking way.
- No web/mobile UI change (the UI already renders `fieldsPushed` / the refusal reason verbatim).
- No new endpoint, no new credential scope (same JWT, same appInfos/appStoreVersions reads already used).
