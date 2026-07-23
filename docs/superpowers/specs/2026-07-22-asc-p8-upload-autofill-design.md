# App Store Connect `.p8` Upload & Auto-Fill — Design

**Date:** 2026-07-22
**Status:** Approved (pending user review of this doc)
**Component:** `cloud/web/src/features/appDetail/ConnectAscCard.tsx`

## Goal

Let a user click **Upload .p8**, pick the key file Apple gave them, and have
the connect form fill itself in — instead of hand-copying the PEM body and Key
ID out of a file and the App Store Connect UI.

## Motivation

Today the un-connected ASC form has three fields the user fills by hand:
**Key ID**, **Issuer ID**, and a textarea for the **contents of the `.p8`**.
Copying a multi-line PEM out of a downloaded file and pasting it into a textarea
is error-prone (trailing whitespace, partial selection), and the Key ID has to
be transcribed from Apple's filename or UI. A file picker removes both frictions
for the two fields that are actually derivable from the file.

## What is (and isn't) in a `.p8`

An App Store Connect API key downloads as `AuthKey_<KEYID>.p8`. The file body is
a PKCS#8 PEM block:

```
-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg...
-----END PRIVATE KEY-----
```

This is a base64 DER encoding of the **EC private key only** (P-256 curve OID,
the private scalar, and the public point). Load-bearing consequence:

- **Key contents** → present in the file. Auto-fillable.
- **Key ID** → present **only in Apple's filename**, never in the PEM body.
  Auto-fillable *from the filename* when the filename matches Apple's pattern.
- **Issuer ID** → a per-account UUID that identifies the Apple team. **Not in
  the file at all.** Cannot be derived from the `.p8`.

We do not pretend otherwise. There is no "parse the Key ID out of the PEM"
path — it is provably impossible for a real Apple key and would be dead code.

## Behavior

Added to the **un-connected branch only** (the state that has the three input
fields). The already-connected state — metadata + one-click "Run keyed audit" —
is unchanged; it has no fields to fill.

An **Upload .p8** control sits above the existing three inputs. It wraps a
hidden `<input type="file" accept=".p8">`. On file selection:

1. **Read the file as text.**
2. **Validate it looks like an EC private key** (see *Validation* below).
   - **Invalid** → show error *"That doesn't look like a .p8 private key.
     Upload the file you downloaded from Apple."* and change **nothing** —
     existing field values are preserved, no partial fill.
   - **Valid** → continue.
3. **Fill the `.p8` textarea** with the file's text (trimmed of a trailing
   newline, otherwise verbatim).
4. **Parse Key ID from the filename** via `^AuthKey_([A-Za-z0-9]+)\.p8$`.
   - Match → fill **Key ID**.
   - No match (renamed file) → leave **Key ID** empty for manual entry. The
     contents were still valid and are still filled.
5. **Issuer ID** is pre-filled from `localStorage` (last-used value) on mount,
   independent of upload. Editable. On a **successful** connect, the entered
   Issuer ID is written back to `localStorage`.

Manual typing/pasting continues to work exactly as before. Upload is purely
additive — every existing test in `ConnectAscCard.test.tsx` must still pass
unchanged.

### Field-fill matrix

| Source                         | .p8 contents | Key ID        | Issuer ID          |
| ------------------------------ | ------------ | ------------- | ------------------ |
| Upload `AuthKey_ABC123.p8`     | filled       | `ABC123`      | from localStorage  |
| Upload renamed `mykey.p8`      | filled       | *(empty)*     | from localStorage  |
| Upload wrong file (`.cer`)     | *(unchanged)*| *(unchanged)* | *(unchanged)* + err|
| Manual paste (unchanged path)  | typed        | typed         | typed              |

## Validation

`looksLikeEcPrivateKey(text: string): boolean` — a cheap, honest structural
check, not full crypto parsing:

1. Contains a `-----BEGIN PRIVATE KEY-----` header and matching
   `-----END PRIVATE KEY-----` footer.
2. The base64 body (headers stripped, whitespace removed) decodes cleanly.
3. The decoded DER begins with the SEQUENCE/version bytes of a PKCS#8
   `PrivateKeyInfo` (`0x30`) — a shape check, deliberately lenient so we accept
   the real Apple key without hard-failing on curve-specific byte offsets.

Purpose: reject a `.cer`, `.mobileprovision`, image, or random text file with a
clear message before it lands in the textarea. It is **not** a cryptographic
validity guarantee — the server's mint step (`ascJwt.ts`) remains the real
authority on whether the key works. This is a fat-finger guard, and we say so.

Rejected: encrypted PKCS#8 (`-----BEGIN ENCRYPTED PRIVATE KEY-----`) — App
Store Connect never issues encrypted keys, so this correctly flags a wrong file.

## Custody & privacy

Unchanged from the existing card's honest custody model, with one addition:

- The `.p8` secret is **never** persisted client-side. The file is read into
  React state (the same textarea value the user would have pasted) and sent
  once on connect, exactly as today. No `localStorage`, no re-read.
- **Only the Issuer ID** — a non-secret UUID identifying the Apple team — is
  persisted to `localStorage` under a single key (e.g. `shipaso.asc.issuerId`).
  This is a convenience for the stable-per-account value, not a secret.
- The file's bytes never leave the browser except via the existing connect POST.

## Structure (small, DI-friendly, testable)

Two new pure/near-pure modules keep the logic out of the component and unit-
testable without a DOM:

- **`cloud/web/src/features/appDetail/ascKeyFile.ts`** — pure functions:
  - `parseKeyIdFromFilename(name: string): string | null`
  - `looksLikeEcPrivateKey(text: string): boolean`
  - `normalizeP8(text: string): string` (strip a single trailing newline)
- **`cloud/web/src/features/appDetail/issuerIdMemory.ts`** — thin,
  mockable `localStorage` wrapper:
  - `readIssuerId(): string`  (returns `""` when absent or storage unavailable)
  - `writeIssuerId(value: string): void`  (no-op on failure — private mode etc.)

`ConnectAscCard.tsx` wires them:
- a hidden `<input type="file" accept=".p8" data-testid="asc-p8-file">`
- an **Upload .p8** button (`data-testid="asc-p8-upload"`) that clicks the input
- an upload-error line (`data-testid="asc-p8-file-error"`)
- `useState` init for `issuerId` reads `readIssuerId()`
- the connect `onClick` calls `writeIssuerId(issuerId.trim())` on success

`localStorage`/storage access is guarded (try/catch) so SSR, private mode, and
disabled-storage deployments degrade to "empty Issuer ID", never a throw —
consistent with the card's existing degradation posture.

## Testing

Local convention is `*.test.tsx` colocated (jsdom + `@testing-library/react`),
**not** the global `*.spec.ts` — follow the repo.

- **`ascKeyFile.test.ts`** (pure, no DOM):
  - `parseKeyIdFromFilename`: `AuthKey_ABC123.p8` → `ABC123`; `AuthKey_2X9.p8` →
    `2X9`; `mykey.p8` → `null`; `AuthKey_.p8` → `null`; `AuthKey_ABC.pem` →
    `null`; case in body preserved.
  - `looksLikeEcPrivateKey`: real P-256 PKCS#8 fixture → `true`; `.cer`/random
    text → `false`; encrypted PKCS#8 header → `false`; empty → `false`;
    header present but body not base64 → `false`.
  - `normalizeP8`: strips exactly one trailing `\n`; leaves interior intact.
- **`issuerIdMemory.test.ts`**: read-after-write round-trips; read with nothing
  stored → `""`; both functions swallow a throwing `localStorage` (mock that
  throws) and return `""` / no-op.
- **`ConnectAscCard.test.tsx`** (additions; existing tests untouched):
  - upload `AuthKey_KID9.p8` fixture → Key ID field = `KID9`, textarea = body.
  - upload renamed valid `.p8` → textarea filled, Key ID stays empty.
  - upload a non-key file → `asc-p8-file-error` shown, fields unchanged.
  - Issuer ID pre-fills from a seeded `localStorage` value on mount.
  - successful connect writes the entered Issuer ID to `localStorage`.

  File uploads in jsdom are driven with `fireEvent.change(input, { target: {
  files: [new File([text], name)] } })`; `File.text()` is available under
  jsdom 25.

## Out of scope (YAGNI)

- Re-key/rotate upload in the connected state.
- Drag-and-drop.
- Parsing Key ID from PEM contents (impossible — see above).
- Deriving/validating Issuer ID (not in the file; server validates on mint).
- Any server, API, or DB change. This is entirely client-side.
