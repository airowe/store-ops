# App Store Connect API-Key JSON Bundle Upload — Design

**Date:** 2026-07-23
**Status:** Approved (pending user review of this doc)
**Component:** `cloud/web/src/features/appDetail/ConnectAscCard.tsx`, `ascKeyFile.ts`
**Builds on:** `2026-07-22-asc-p8-upload-autofill-design.md` (the `.p8` upload)

## Goal

Let the connect form's upload control also accept a **Fastlane-style API-key
JSON bundle** and fill **all three** fields — Key ID, Issuer ID, and the `.p8`
contents — because the JSON is the one format that carries the Issuer ID.

## Motivation

The `.p8` upload (PR #316) can fill the key contents and Key ID (from Apple's
filename) but **not the Issuer ID** — it isn't in a `.p8`, isn't in the API
(confirmed against Apple's docs), and exists only on the App Store Connect
Integrations page. Fastlane solved the same problem by bundling all three into
a single JSON file (`key_id` / `issuer_id` / `key`). Many users already have
this file — Fastlane's `--api_key_path`, or a CI secret. Accepting it makes
ShipASO a drop-in for anyone already holding a Fastlane credential file, and
closes the one gap the `.p8`-only path structurally cannot.

## The Fastlane bundle format

```json
{
  "key_id": "D383SF739",
  "issuer_id": "6053b7fe-68a8-4acb-89be-165aa6465141",
  "key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "duration": 1200,
  "in_house": false,
  "is_key_content_base64": false
}
```

- **`key_id`** (required) — the API key identifier.
- **`key`** (required) — the `.p8` PEM contents, inline.
- **`issuer_id`** (optional) — the team identifier. **Absent/null for an
  individual API key** (Fastlane: "It should be nil if the key is individual").
- **`is_key_content_base64`** (optional) — when `true`, `key` is base64-encoded
  (a CI convention to survive environment-variable newline mangling).
- **`duration`, `in_house`** — ignored by ShipASO (our mint path sets its own
  short token duration and does not model enterprise/in-house teams).

## Approach

**Extend the existing upload, do not fork it.** The single control accepts both
formats and routes by **content sniff**, not extension alone:

- `accept=".p8,.json"` on the file input; button relabeled **Upload key file**.
- On pick, read the file text. If the trimmed text starts with `{`, route to
  the JSON-bundle path; otherwise route to the existing PEM (`.p8`) path.
- Extension is a hint, content is the authority — a `.json` renamed to `.p8`
  (or vice versa) still works.

All new parsing lives in the pure, DOM-free `ascKeyFile.ts` module so it
unit-tests without a browser. `ConnectAscCard.tsx` gains only a routing branch.

## New pure function (`ascKeyFile.ts`)

```ts
type KeyBundle = { keyId: string; issuerId: string | null; key: string };
type KeyBundleResult =
  | { ok: true; bundle: KeyBundle }
  | { ok: false };

parseKeyBundleJson(text: string): KeyBundleResult
```

Logic:
1. `JSON.parse(text)`; on throw → `{ ok: false }`.
2. Require `key_id` (non-empty string) and `key` (non-empty string) → else
   `{ ok: false }`.
3. If `is_key_content_base64 === true`, `atob` the `key`; on decode failure →
   `{ ok: false }`.
4. Validate the resulting `key` with the **existing** `looksLikeEcPrivateKey`
   (reuse — no new crypto). Fail → `{ ok: false }`.
5. `issuer_id`: if a non-empty string, use it; otherwise `issuerId: null`
   (individual key — a valid shape, not an error).
6. Return `{ ok: true, bundle: { keyId, issuerId, key } }` with the `key`
   passed through `normalizeP8`.

The result is a single boolean-tagged union — the component decides messaging;
the pure function only decides usable-or-not.

## Fill behavior

On a valid JSON bundle, fill from the parse result and clear any file error:

| Uploaded | .p8 contents | Key ID | Issuer ID |
| --- | --- | --- | --- |
| Fastlane JSON (team key) | `key` | `key_id` | `issuer_id` (**overrides** remembered) |
| JSON, individual key (no `issuer_id`) | `key` | `key_id` | *(unchanged — not clobbered)* |
| JSON, `is_key_content_base64:true` | `atob(key)` | `key_id` | `issuer_id` |
| `.p8` (existing path) | contents | from filename | *(remembered — unchanged)* |
| malformed JSON / bad shape | *(unchanged)* | *(unchanged)* | *(unchanged)* + error |

**Issuer ID rules (the one subtlety):**
- A **present** `issuer_id` in the bundle **overrides** the remembered/typed
  value. The file is authoritative — uploading a bundle for a different team
  must show *that* team's Issuer ID, never a stale remembered one.
- An **absent** `issuer_id` (individual key) leaves the field **as-is** — never
  clobber a remembered value with empty.

**Honesty invariant preserved:** a field is filled only when the value is
genuinely present in the bundle. Nothing is fabricated. The `.p8` secret is
still never persisted client-side; only the Issuer ID (a non-secret UUID)
continues to be remembered via the existing `issuerIdMemory` path on a
successful connect.

## Error handling

Same "fill what we can, or fill nothing" discipline as the `.p8` path. A JSON
route that can't produce a usable bundle rejects and changes **no field**:

- New error copy (verbatim): `That file isn't a valid API-key JSON. Upload the
  .p8 or the JSON key file you exported.`
- One message covers every JSON-shaped-but-unusable case: invalid JSON, missing
  `key_id`/`key`, `key` fails the EC-key check, or base64 `key` that doesn't
  decode to a valid key. No per-field enumeration.
- The existing `.p8` error copy is unchanged. The card thus has two error
  strings, chosen by which branch the content sniff routed into.

## Structure

- **`ascKeyFile.ts`** — add `parseKeyBundleJson` and its types. Reuses
  `looksLikeEcPrivateKey` and `normalizeP8`. No change to existing exports.
- **`ConnectAscCard.tsx`** — `onFilePicked` gains a content-sniff branch:
  JSON → `parseKeyBundleJson` → fill three fields (Issuer ID per the rules
  above) or set the JSON error; else → existing PEM path unchanged. Relabel the
  button to "Upload key file" and set `accept=".p8,.json"`.

No API, DB, migration, or server change. Entirely client-side. The `.p8` path,
the manual-paste flow, and the connected-state branch are all unchanged.

## Testing

Local convention `*.test.ts(x)` (jsdom + `@testing-library/react`).

- **`ascKeyFile.test.ts`** (add to existing, pure): `parseKeyBundleJson` —
  - valid team bundle → `{ ok:true, bundle:{ keyId, issuerId, key } }`.
  - individual bundle (no `issuer_id`) → `ok:true`, `issuerId: null`.
  - `is_key_content_base64:true` with a base64'd valid key → `ok:true`, key
    decoded.
  - missing `key_id` → `ok:false`; missing `key` → `ok:false`.
  - `key` present but not an EC key → `ok:false`.
  - non-JSON text → `ok:false`; `is_key_content_base64:true` but `key` not
    base64 → `ok:false`.
  - `issuer_id: null` and `issuer_id: ""` both → `issuerId: null`.
- **`ConnectAscCard.test.tsx`** (additions; existing tests untouched):
  - upload a team JSON → all three fields filled (Key ID, Issuer ID, `.p8`).
  - upload an individual JSON (no `issuer_id`) → Key ID + `.p8` filled, a
    pre-seeded remembered Issuer ID is **not** cleared.
  - upload a team JSON when a *different* Issuer ID is already in the field →
    field is **overridden** with the bundle's `issuer_id`.
  - upload a `{`-leading non-key JSON → JSON error shown, all fields unchanged.
  - upload a `.p8` still works exactly as before (route-by-content regression).

## Out of scope (YAGNI)

- Honoring `duration` / `in_house` (our mint owns duration; no enterprise model).
- Exporting a JSON bundle from ShipASO.
- Drag-and-drop, multi-file.
- Re-key upload in the connected state (unchanged from #316's scope).
- Any server/API/DB change.
