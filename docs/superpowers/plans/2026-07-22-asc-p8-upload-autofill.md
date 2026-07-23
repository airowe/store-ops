# App Store Connect `.p8` Upload & Auto-Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Upload .p8" control to the App Store Connect connect form that reads the key file, validates it, and auto-fills the `.p8` contents + Key ID, while remembering the last Issuer ID.

**Architecture:** Two new colocated pure/near-pure modules hold all logic (`ascKeyFile.ts` for parsing/validation, `issuerIdMemory.ts` for a guarded `localStorage` wrapper). `ConnectAscCard.tsx` wires a hidden file input to them. Entirely client-side — no API, DB, or server change. Existing manual-paste flow is untouched and every existing test in `ConnectAscCard.test.tsx` must still pass verbatim.

**Tech Stack:** React 18 + TypeScript (strict), Vitest 2 + jsdom 25 + `@testing-library/react`, TanStack Query v5.

## Global Constraints

- **Import extensions:** all relative imports use a `.js` extension even from `.ts`/`.tsx` (e.g. `import { x } from "./ascKeyFile.js"`). This is the repo convention under `moduleResolution: "Bundler"` — match it exactly.
- **Test file naming:** colocated `*.test.ts` / `*.test.tsx` (jsdom + `@testing-library/react`). NOT `*.spec.ts`. Follow the local convention.
- **Exports:** named exports only; no default exports. Each module opens with a short doc-comment header explaining its purpose, matching sibling helpers (`pageTitle.ts`, `envPill.ts`).
- **localStorage key namespace:** the codebase uses `store-ops:` prefix (see `ThemeToggle.tsx` → `"store-ops:theme"`). Use `"store-ops:asc.issuerId"`. Guard every storage access with `try { … } catch { /* ignore */ }` — never throw.
- **Honesty invariant:** never fabricate a field. If the Key ID is not derivable (renamed file) leave it empty; the `.p8` secret is NEVER persisted client-side — only the non-secret Issuer ID UUID is.
- **Filename regex (verbatim):** `/^AuthKey_([A-Za-z0-9]+)\.p8$/`
- **Upload error copy (verbatim):** `That doesn't look like a .p8 private key. Upload the file you downloaded from Apple.`
- **New test IDs (verbatim):** file input `asc-p8-file`, upload button `asc-p8-upload`, upload error line `asc-p8-file-error`.

---

## File Structure

- **Create** `cloud/web/src/features/appDetail/ascKeyFile.ts` — pure parse/validate helpers.
- **Create** `cloud/web/src/features/appDetail/ascKeyFile.test.ts` — unit tests (no DOM).
- **Create** `cloud/web/src/features/appDetail/issuerIdMemory.ts` — guarded `localStorage` wrapper.
- **Create** `cloud/web/src/features/appDetail/issuerIdMemory.test.ts` — unit tests.
- **Modify** `cloud/web/src/features/appDetail/ConnectAscCard.tsx` — wire the upload control.
- **Modify** `cloud/web/src/features/appDetail/ConnectAscCard.test.tsx` — add upload/memory tests (existing tests unchanged).

---

## Task 1: Pure key-file parsing & validation module

**Files:**
- Create: `cloud/web/src/features/appDetail/ascKeyFile.ts`
- Test: `cloud/web/src/features/appDetail/ascKeyFile.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module, no imports).
- Produces:
  - `parseKeyIdFromFilename(name: string): string | null`
  - `looksLikeEcPrivateKey(text: string): boolean`
  - `normalizeP8(text: string): string`

- [ ] **Step 1: Write the failing test**

Create `cloud/web/src/features/appDetail/ascKeyFile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseKeyIdFromFilename,
  looksLikeEcPrivateKey,
  normalizeP8,
} from "./ascKeyFile.js";

// A real, structurally-valid P-256 PKCS#8 key (test fixture — not a live Apple key).
const REAL_P8 = [
  "-----BEGIN PRIVATE KEY-----",
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgevZzL1gdAFr88hb2",
  "OF/2NxApJCzGCEDdfSp6VQO3o8fhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r",
  "1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G",
  "-----END PRIVATE KEY-----",
].join("\n");

describe("parseKeyIdFromFilename", () => {
  it("extracts the Key ID from Apple's AuthKey_<ID>.p8 pattern", () => {
    expect(parseKeyIdFromFilename("AuthKey_ABC123.p8")).toBe("ABC123");
    expect(parseKeyIdFromFilename("AuthKey_2X9.p8")).toBe("2X9");
  });
  it("returns null for a renamed or non-matching filename", () => {
    expect(parseKeyIdFromFilename("mykey.p8")).toBeNull();
    expect(parseKeyIdFromFilename("AuthKey_.p8")).toBeNull();
    expect(parseKeyIdFromFilename("AuthKey_ABC.pem")).toBeNull();
    expect(parseKeyIdFromFilename("AuthKey_ABC 123.p8")).toBeNull();
  });
});

describe("looksLikeEcPrivateKey", () => {
  it("accepts a real P-256 PKCS#8 PEM", () => {
    expect(looksLikeEcPrivateKey(REAL_P8)).toBe(true);
  });
  it("rejects a wrong file, empty input, and encrypted PKCS#8", () => {
    expect(looksLikeEcPrivateKey("not a key at all")).toBe(false);
    expect(looksLikeEcPrivateKey("")).toBe(false);
    expect(
      looksLikeEcPrivateKey(
        "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIB\n-----END ENCRYPTED PRIVATE KEY-----",
      ),
    ).toBe(false);
  });
  it("rejects a header whose body is not valid base64", () => {
    expect(
      looksLikeEcPrivateKey(
        "-----BEGIN PRIVATE KEY-----\n!!!not base64!!!\n-----END PRIVATE KEY-----",
      ),
    ).toBe(false);
  });
});

describe("normalizeP8", () => {
  it("strips exactly one trailing newline and leaves the interior intact", () => {
    expect(normalizeP8("a\nb\n")).toBe("a\nb");
    expect(normalizeP8("a\nb")).toBe("a\nb");
    expect(normalizeP8("a\nb\n\n")).toBe("a\nb\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cloud/web && npx vitest run src/features/appDetail/ascKeyFile.test.ts`
Expected: FAIL — cannot resolve `./ascKeyFile.js` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `cloud/web/src/features/appDetail/ascKeyFile.ts`:

```ts
/**
 * Pure parsing/validation for an uploaded App Store Connect .p8 key file.
 * Framework-free so it unit-tests without a DOM (matches the pure shell helpers
 * pageTitle/envPill). See docs/superpowers/specs/2026-07-22-asc-p8-upload-autofill-design.md.
 *
 * Honest by construction:
 *   • the Key ID lives ONLY in Apple's filename, never in the PEM body, so we
 *     parse it from the name or return null — we never pretend to derive it.
 *   • looksLikeEcPrivateKey is a fat-finger guard (reject a .cer / image / text
 *     file), NOT a crypto validity guarantee — the server's mint step remains
 *     the real authority on whether the key works.
 */

/** Apple downloads API keys as `AuthKey_<KEYID>.p8`. */
const FILENAME_RE = /^AuthKey_([A-Za-z0-9]+)\.p8$/;

/** Extract the Key ID from Apple's filename, or null if the name doesn't match. */
export function parseKeyIdFromFilename(name: string): string | null {
  const m = FILENAME_RE.exec(name);
  return m ? m[1] : null;
}

/**
 * Structural check that `text` is an unencrypted EC private key in PKCS#8 PEM.
 * Lenient on curve specifics; strict enough to reject a wrong file.
 */
export function looksLikeEcPrivateKey(text: string): boolean {
  const header = "-----BEGIN PRIVATE KEY-----";
  const footer = "-----END PRIVATE KEY-----";
  if (!text.includes(header) || !text.includes(footer)) return false;

  const body = text
    .slice(text.indexOf(header) + header.length, text.indexOf(footer))
    .replace(/\s+/g, "");
  if (body.length === 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return false;

  let der: Uint8Array;
  try {
    const bin = atob(body);
    der = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  // PKCS#8 PrivateKeyInfo is a DER SEQUENCE — first byte 0x30.
  return der.length > 2 && der[0] === 0x30;
}

/** Strip a single trailing newline; leave the rest of the PEM verbatim. */
export function normalizeP8(text: string): string {
  return text.replace(/\n$/, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cloud/web && npx vitest run src/features/appDetail/ascKeyFile.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/appDetail/ascKeyFile.ts cloud/web/src/features/appDetail/ascKeyFile.test.ts
git commit -m "feat(asc): pure .p8 filename parse + EC-key validation helpers"
```

---

## Task 2: Guarded Issuer-ID localStorage wrapper

**Files:**
- Create: `cloud/web/src/features/appDetail/issuerIdMemory.ts`
- Test: `cloud/web/src/features/appDetail/issuerIdMemory.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `readIssuerId(): string` — last saved Issuer ID, or `""` if none / storage unavailable.
  - `writeIssuerId(value: string): void` — persist; no-op on any storage failure.

- [ ] **Step 1: Write the failing test**

Create `cloud/web/src/features/appDetail/issuerIdMemory.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readIssuerId, writeIssuerId } from "./issuerIdMemory.js";

describe("issuerIdMemory", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("round-trips a written Issuer ID", () => {
    writeIssuerId("69a6b21c-0000");
    expect(readIssuerId()).toBe("69a6b21c-0000");
  });

  it("returns empty string when nothing is stored", () => {
    expect(readIssuerId()).toBe("");
  });

  it("swallows a throwing localStorage on read and returns empty", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readIssuerId()).toBe("");
  });

  it("swallows a throwing localStorage on write (no throw)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeIssuerId("x")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cloud/web && npx vitest run src/features/appDetail/issuerIdMemory.test.ts`
Expected: FAIL — cannot resolve `./issuerIdMemory.js`.

- [ ] **Step 3: Write minimal implementation**

Create `cloud/web/src/features/appDetail/issuerIdMemory.ts`:

```ts
/**
 * Remembers the last App Store Connect Issuer ID so the connect form can
 * pre-fill it. The Issuer ID is a non-secret UUID identifying the Apple team —
 * safe to persist. The .p8 secret is NEVER stored here.
 *
 * Storage access is guarded (private mode / SSR / disabled storage) and
 * degrades to "" / no-op rather than throwing — matches ThemeToggle's pattern.
 */
const KEY = "store-ops:asc.issuerId";

export function readIssuerId(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeIssuerId(value: string): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cloud/web && npx vitest run src/features/appDetail/issuerIdMemory.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/appDetail/issuerIdMemory.ts cloud/web/src/features/appDetail/issuerIdMemory.test.ts
git commit -m "feat(asc): guarded localStorage wrapper for remembering Issuer ID"
```

---

## Task 3: Wire the upload control into ConnectAscCard

**Files:**
- Modify: `cloud/web/src/features/appDetail/ConnectAscCard.tsx`
- Test: `cloud/web/src/features/appDetail/ConnectAscCard.test.tsx`

**Interfaces:**
- Consumes (from Task 1): `parseKeyIdFromFilename`, `looksLikeEcPrivateKey`, `normalizeP8` from `./ascKeyFile.js`.
- Consumes (from Task 2): `readIssuerId`, `writeIssuerId` from `./issuerIdMemory.js`.
- Produces: no new exports (component-internal wiring).

**Context for the implementer — the current component (`ConnectAscCard.tsx`):**
The un-connected branch renders (in a `<div style={{ display: "grid", gap: 8 }}>`) three inputs: `asc-key-id`, `asc-issuer-id`, `asc-p8` (textarea), an optional `asc-store` checkbox (only when `enabled`), and the `asc-connect` button. State: `keyId`, `issuerId`, `p8`, `store` via `useState`. The connect button calls `run.mutate({ p8, keyId: keyId.trim(), issuerId: issuerId.trim(), ...(enabled ? { store } : {}) })`. Do NOT alter the connected branch, the how-to `<details>`, or the existing three inputs' behavior.

- [ ] **Step 1: Write the failing tests**

Append these tests inside the existing `describe("<ConnectAscCard />", …)` block in `cloud/web/src/features/appDetail/ConnectAscCard.test.tsx`. Add the imports for the fixture at the top of the file (after the existing imports):

```ts
// Structurally-valid P-256 PKCS#8 (test fixture, not a live key).
const REAL_P8 = [
  "-----BEGIN PRIVATE KEY-----",
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgevZzL1gdAFr88hb2",
  "OF/2NxApJCzGCEDdfSp6VQO3o8fhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r",
  "1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G",
  "-----END PRIVATE KEY-----",
].join("\n");

function uploadFile(name: string, contents: string) {
  const input = screen.getByTestId("asc-p8-file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([contents], name)] } });
}
```

Tests (append inside the describe block):

```ts
it("upload AuthKey_<ID>.p8: fills the .p8 contents and parses Key ID from the filename", async () => {
  const { client } = makeClient();
  renderCard(client);
  await waitFor(() => screen.getByTestId("asc-p8-file"));
  uploadFile("AuthKey_KID9.p8", REAL_P8);
  await waitFor(() =>
    expect((screen.getByTestId("asc-key-id") as HTMLInputElement).value).toBe("KID9"),
  );
  expect((screen.getByTestId("asc-p8") as HTMLTextAreaElement).value).toContain(
    "BEGIN PRIVATE KEY",
  );
});

it("upload a renamed valid .p8: fills contents but leaves Key ID empty", async () => {
  const { client } = makeClient();
  renderCard(client);
  await waitFor(() => screen.getByTestId("asc-p8-file"));
  uploadFile("my-renamed-key.p8", REAL_P8);
  await waitFor(() =>
    expect((screen.getByTestId("asc-p8") as HTMLTextAreaElement).value).toContain(
      "BEGIN PRIVATE KEY",
    ),
  );
  expect((screen.getByTestId("asc-key-id") as HTMLInputElement).value).toBe("");
});

it("upload a non-key file: shows an error and leaves every field unchanged", async () => {
  const { client } = makeClient();
  renderCard(client);
  await waitFor(() => screen.getByTestId("asc-p8-file"));
  uploadFile("cert.cer", "this is not a private key");
  await waitFor(() => screen.getByTestId("asc-p8-file-error"));
  expect((screen.getByTestId("asc-p8") as HTMLTextAreaElement).value).toBe("");
  expect((screen.getByTestId("asc-key-id") as HTMLInputElement).value).toBe("");
});

it("pre-fills Issuer ID from localStorage on mount", async () => {
  localStorage.setItem("store-ops:asc.issuerId", "REMEMBERED-ISS");
  const { client } = makeClient();
  renderCard(client);
  await waitFor(() =>
    expect((screen.getByTestId("asc-issuer-id") as HTMLInputElement).value).toBe(
      "REMEMBERED-ISS",
    ),
  );
  localStorage.clear();
});

it("remembers the entered Issuer ID after a successful connect", async () => {
  localStorage.clear();
  const { client } = makeClient();
  renderCard(client);
  await waitFor(() => screen.getByTestId("asc-key-id"));
  fireEvent.change(screen.getByTestId("asc-key-id"), { target: { value: "K" } });
  fireEvent.change(screen.getByTestId("asc-issuer-id"), { target: { value: "ISS-SAVE" } });
  fireEvent.change(screen.getByTestId("asc-p8"), { target: { value: "P" } });
  fireEvent.click(screen.getByTestId("asc-connect"));
  await waitFor(() =>
    expect(localStorage.getItem("store-ops:asc.issuerId")).toBe("ISS-SAVE"),
  );
  localStorage.clear();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud/web && npx vitest run src/features/appDetail/ConnectAscCard.test.tsx`
Expected: the 5 new tests FAIL (no `asc-p8-file` element / no localStorage write); the 7 existing tests still PASS.

- [ ] **Step 3: Implement the wiring**

In `cloud/web/src/features/appDetail/ConnectAscCard.tsx`:

(a) Add imports after the existing `@shipaso/api` import:

```ts
import { useRef } from "react";
import { parseKeyIdFromFilename, looksLikeEcPrivateKey, normalizeP8 } from "./ascKeyFile.js";
import { readIssuerId, writeIssuerId } from "./issuerIdMemory.js";
```

(Merge `useRef` into the existing `import { useState } from "react";` line so it reads `import { useState, useRef } from "react";` — do not add a duplicate React import.)

(b) Initialize `issuerId` from memory and add upload state. Change:

```ts
const [issuerId, setIssuerId] = useState("");
```

to:

```ts
const [issuerId, setIssuerId] = useState(() => readIssuerId());
const [fileError, setFileError] = useState("");
const fileInputRef = useRef<HTMLInputElement | null>(null);
```

(c) Add the upload handler (place it above the `return`):

```ts
async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  e.target.value = ""; // allow re-picking the same file
  if (!file) return;
  const text = await file.text();
  if (!looksLikeEcPrivateKey(text)) {
    setFileError(
      "That doesn't look like a .p8 private key. Upload the file you downloaded from Apple.",
    );
    return;
  }
  setFileError("");
  setP8(normalizeP8(text));
  const parsedKeyId = parseKeyIdFromFilename(file.name);
  if (parsedKeyId) setKeyId(parsedKeyId);
}
```

(d) Persist the Issuer ID on a successful run. In the `run` mutation's `onSuccess`, add `writeIssuerId(issuerId.trim());` as the first line (before the existing `invalidateQueries` call).

(e) Render the upload control at the TOP of the `<div style={{ display: "grid", gap: 8 }}>`, before the `asc-key-id` input:

```tsx
<div>
  <input
    ref={fileInputRef}
    data-testid="asc-p8-file"
    type="file"
    accept=".p8"
    style={{ display: "none" }}
    onChange={onFilePicked}
  />
  <button
    type="button"
    className="btn"
    data-testid="asc-p8-upload"
    onClick={() => fileInputRef.current?.click()}
  >
    Upload .p8
  </button>
  {fileError ? (
    <p className="micro" data-testid="asc-p8-file-error">
      {fileError}
    </p>
  ) : null}
</div>
```

- [ ] **Step 4: Run the full component suite to verify green**

Run: `cd cloud/web && npx vitest run src/features/appDetail/ConnectAscCard.test.tsx`
Expected: PASS — all 12 tests (7 existing + 5 new).

- [ ] **Step 5: Typecheck**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/appDetail/ConnectAscCard.tsx cloud/web/src/features/appDetail/ConnectAscCard.test.tsx
git commit -m "feat(asc): upload .p8 to auto-fill the connect form + remember Issuer ID"
```

---

## Task 4: Full web suite + typecheck gate

**Files:** none (verification only).

- [ ] **Step 1: Run the entire web test suite**

Run: `cd cloud/web && npx vitest run`
Expected: PASS — full suite green, no regressions from the three new/modified files.

- [ ] **Step 2: Typecheck the whole web workspace**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Lint (if the workspace defines it)**

Run: `cd cloud/web && npm run lint --if-present`
Expected: clean, or no lint script (skip).

No commit — this task is the final gate before the whole-branch review.

---

## Self-Review

- **Spec coverage:** Upload button + hidden input (Task 3e); read file text (3c); validate EC key + reject wrong file with exact copy (3c, Task 1); fill `.p8` contents (3c); parse Key ID from filename, empty on mismatch (3c, Task 1); Issuer ID pre-fill from localStorage + persist on success (3b/3d, Task 2); manual paste untouched (existing tests retained in Task 3). Field-fill matrix rows all covered by Task 3 tests. Out-of-scope items (re-key, drag-drop, PEM Key-ID parse, server changes) — none introduced. ✅
- **Placeholder scan:** none — every step has concrete code/commands. ✅
- **Type consistency:** `parseKeyIdFromFilename`/`looksLikeEcPrivateKey`/`normalizeP8` and `readIssuerId`/`writeIssuerId` signatures are identical across their defining task (1/2) and consumer (3). localStorage key `store-ops:asc.issuerId` and all test IDs match verbatim across tasks. ✅
