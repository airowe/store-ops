# Phase 3 — direct ASC push per market

Depends on: Phase 2 (pushes only APPROVED locales). Flag-gated by
`ASC_WRITE_ENABLED` like every ASC write.

## The missing write: `createAscLocalization`

`applyAscMetadata({locale})` PATCHes an existing localization and throws when
the locale is absent on the editable version (B1) — which is exactly the state
of a NEW market. Mirror of #34's `createAscVersion`:

```ts
export async function createAscLocalization(
  fetchFn: FetchLike,
  opts: { token: string; versionId: string; locale: string },
): Promise<{ id: string; locale: string }>
// POST /v1/appStoreVersionLocalizations
// { data: { type, attributes: { locale }, relationships: { appStoreVersion } } }
```

ASC errors surface honestly (already-exists, locale-not-supported-by-app).

## API: `POST /runs/:id/asc/push-locale`

Body: `{ p8, keyId, issuerId, locale }` — same per-action discipline as
`/asc/push` and `/asc/create-version`:

1. Flag + approved-run + owner guards (identical to `ascPushRoute`).
2. The locale must be in the run's **approved** `localizedCopy` map — pushing
   a never-approved draft is a 403, not a convenience.
3. If the localization is missing on the editable version, the response is the
   honest `{ ok:false, reason:"locale not on the version — create it first" }`;
   creation is **its own route + click**
   (`POST /runs/:id/asc/create-localization`), never chained. Same pattern the
   #34 draft-version flow established in the UI.
4. Push = `applyAscMetadata({ copy: localizedCopy[locale], locale })`.

## Constraints carried

- `.p8` in-request only, used once, never persisted.
- Two explicit clicks for a brand-new market (create localization → push),
  three including the draft approval — matching the plan's success criterion.
- Never auto-push, never chain writes.

## Tests

- Engine: payload shape, honest ASC rejection surfacing.
- Route: 403 for unapproved locale (the load-bearing guard), missing-locale
  honest response, happy path pushes the LOCALIZED copy (not en-US — pin the
  body).
