# App Store Connect API-Key JSON Bundle Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the connect form's upload control to also accept a Fastlane-style API-key JSON bundle (`key_id`/`issuer_id`/`key`) and auto-fill all three fields, routing by file content.

**Architecture:** Add one pure function `parseKeyBundleJson` to the existing `ascKeyFile.ts` (reusing `looksLikeEcPrivateKey`/`normalizeP8`), then add a content-sniff routing branch to `ConnectAscCard.tsx`'s `onFilePicked`. Entirely client-side. The `.p8` path, manual-paste flow, and connected-state branch are unchanged; all existing tests must still pass.

**Tech Stack:** React 18 + TypeScript (strict), Vitest 2 + jsdom 25 + `@testing-library/react`.

## Global Constraints

- **Import extensions:** relative imports use a `.js` extension even from `.ts`/`.tsx` (e.g. `from "./ascKeyFile.js"`).
- **Test naming:** colocated `*.test.ts` / `*.test.tsx`. NOT `*.spec.ts`.
- **Exports:** named exports only; no default. Existing `ascKeyFile.ts` exports (`parseKeyIdFromFilename`, `looksLikeEcPrivateKey`, `normalizeP8`) MUST remain unchanged.
- **Reuse, no new crypto:** JSON `key` validation MUST go through the existing `looksLikeEcPrivateKey`. Do not add a second validator.
- **New JSON error copy (verbatim):** `That file isn't a valid API-key JSON. Upload the .p8 or the JSON key file you exported.`
- **Existing `.p8` error copy (unchanged, verbatim):** `That doesn't look like a .p8 private key. Upload the file you downloaded from Apple.`
- **Button label (verbatim):** `Upload key file` (relabeled from "Upload .p8").
- **File input:** `accept=".p8,.json"`.
- **Existing test IDs unchanged:** `asc-p8-file`, `asc-p8-upload`, `asc-p8-file-error`. (No new test IDs — the same error line renders whichever message applies.)
- **Content sniff:** route by content, not extension — trimmed text starting with `{` → JSON bundle; else → PEM path.
- **Issuer ID rules:** a PRESENT `issuer_id` overrides the current field value; an ABSENT/empty `issuer_id` (individual key) leaves the field unchanged (never clobber).
- **Honesty:** fill a field only when its value is genuinely present in the bundle; the `.p8` secret is never persisted client-side.
- Run all test/typecheck commands from `cloud/web/`.

---

## File Structure

- **Modify** `cloud/web/src/features/appDetail/ascKeyFile.ts` — add `parseKeyBundleJson` + its result types. Existing functions untouched.
- **Modify** `cloud/web/src/features/appDetail/ascKeyFile.test.ts` — add `parseKeyBundleJson` tests (append; existing tests untouched).
- **Modify** `cloud/web/src/features/appDetail/ConnectAscCard.tsx` — content-sniff routing in `onFilePicked`; relabel button; `accept=".p8,.json"`.
- **Modify** `cloud/web/src/features/appDetail/ConnectAscCard.test.tsx` — add JSON-upload tests (append; existing tests untouched).

---

## Task 1: `parseKeyBundleJson` pure function

**Files:**
- Modify: `cloud/web/src/features/appDetail/ascKeyFile.ts`
- Test: `cloud/web/src/features/appDetail/ascKeyFile.test.ts`

**Interfaces:**
- Consumes: the existing `looksLikeEcPrivateKey` and `normalizeP8` in the same module.
- Produces:
  - `type KeyBundle = { keyId: string; issuerId: string | null; key: string }`
  - `type KeyBundleResult = { ok: true; bundle: KeyBundle } | { ok: false }`
  - `parseKeyBundleJson(text: string): KeyBundleResult`

- [ ] **Step 1: Write the failing tests**

Append to `cloud/web/src/features/appDetail/ascKeyFile.test.ts`. Add `parseKeyBundleJson` to the existing import from `./ascKeyFile.js`, and reuse the existing `REAL_P8` fixture already defined at the top of that test file.

```ts
describe("parseKeyBundleJson", () => {
  const teamBundle = JSON.stringify({
    key_id: "D383SF739",
    issuer_id: "6053b7fe-68a8-4acb-89be-165aa6465141",
    key: REAL_P8,
  });

  it("parses a Fastlane team bundle into all three fields", () => {
    const r = parseKeyBundleJson(teamBundle);
    expect(r).toEqual({
      ok: true,
      bundle: { keyId: "D383SF739", issuerId: "6053b7fe-68a8-4acb-89be-165aa6465141", key: REAL_P8 },
    });
  });

  it("treats a missing issuer_id (individual key) as issuerId null, not an error", () => {
    const r = parseKeyBundleJson(JSON.stringify({ key_id: "K1", key: REAL_P8 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bundle.issuerId).toBeNull();
  });

  it("treats issuer_id null and empty-string both as issuerId null", () => {
    for (const issuer_id of [null, ""]) {
      const r = parseKeyBundleJson(JSON.stringify({ key_id: "K1", issuer_id, key: REAL_P8 }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.bundle.issuerId).toBeNull();
    }
  });

  it("decodes key when is_key_content_base64 is true", () => {
    const b64 = btoa(REAL_P8);
    const r = parseKeyBundleJson(
      JSON.stringify({ key_id: "K1", issuer_id: "I1", key: b64, is_key_content_base64: true }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bundle.key).toBe(REAL_P8);
  });

  it("rejects a bundle missing key_id or key", () => {
    expect(parseKeyBundleJson(JSON.stringify({ issuer_id: "I1", key: REAL_P8 })).ok).toBe(false);
    expect(parseKeyBundleJson(JSON.stringify({ key_id: "K1", issuer_id: "I1" })).ok).toBe(false);
  });

  it("rejects when key is present but not an EC private key", () => {
    expect(parseKeyBundleJson(JSON.stringify({ key_id: "K1", key: "nope" })).ok).toBe(false);
  });

  it("rejects non-JSON text", () => {
    expect(parseKeyBundleJson("not json at all").ok).toBe(false);
    expect(parseKeyBundleJson("").ok).toBe(false);
  });

  it("rejects is_key_content_base64 true when key does not decode to a valid key", () => {
    const r = parseKeyBundleJson(
      JSON.stringify({ key_id: "K1", key: "!!!not base64!!!", is_key_content_base64: true }),
    );
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud/web && npx vitest run src/features/appDetail/ascKeyFile.test.ts`
Expected: the new `parseKeyBundleJson` tests FAIL (function not exported); the existing tests still PASS.

- [ ] **Step 3: Implement**

Append to `cloud/web/src/features/appDetail/ascKeyFile.ts` (after `normalizeP8`; do not modify existing functions):

```ts
/** A Fastlane-style API-key bundle: the three credential parts ShipASO needs. */
export type KeyBundle = { keyId: string; issuerId: string | null; key: string };

/** Usable-or-not result. The caller decides messaging; this only decides validity. */
export type KeyBundleResult = { ok: true; bundle: KeyBundle } | { ok: false };

/**
 * Parse a Fastlane-style API-key JSON bundle. The JSON is the one credential
 * format that carries the Issuer ID (a .p8 does not). Requires key_id + key;
 * issuer_id is optional (absent/null for an individual key). Honors
 * is_key_content_base64. Reuses looksLikeEcPrivateKey — no separate validator.
 * duration/in_house are ignored (our mint owns duration; no enterprise model).
 */
export function parseKeyBundleJson(text: string): KeyBundleResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false };
  const o = raw as Record<string, unknown>;

  const keyId = o.key_id;
  if (typeof keyId !== "string" || keyId.length === 0) return { ok: false };

  let key = o.key;
  if (typeof key !== "string" || key.length === 0) return { ok: false };

  if (o.is_key_content_base64 === true) {
    try {
      key = atob(key);
    } catch {
      return { ok: false };
    }
  }
  if (!looksLikeEcPrivateKey(key)) return { ok: false };

  const issuerRaw = o.issuer_id;
  const issuerId = typeof issuerRaw === "string" && issuerRaw.length > 0 ? issuerRaw : null;

  return { ok: true, bundle: { keyId, issuerId, key: normalizeP8(key) } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud/web && npx vitest run src/features/appDetail/ascKeyFile.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Typecheck**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/appDetail/ascKeyFile.ts cloud/web/src/features/appDetail/ascKeyFile.test.ts
git commit -m "feat(asc): parse Fastlane-style API-key JSON bundle (key_id/issuer_id/key)"
```

---

## Task 2: Route the upload by content in ConnectAscCard

**Files:**
- Modify: `cloud/web/src/features/appDetail/ConnectAscCard.tsx`
- Test: `cloud/web/src/features/appDetail/ConnectAscCard.test.tsx`

**Interfaces:**
- Consumes (from Task 1): `parseKeyBundleJson` from `./ascKeyFile.js`.
- Produces: no new exports.

**Context — the current `onFilePicked` and upload JSX (verbatim on the branch):**

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

The upload JSX currently has `accept=".p8"` on the input (`data-testid="asc-p8-file"`) and the button text `Upload .p8` (`data-testid="asc-p8-upload"`). State setters `setKeyId`, `setIssuerId`, `setP8`, `setFileError` all already exist.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("<ConnectAscCard />", …)` block in `ConnectAscCard.test.tsx`. Reuse the existing `REAL_P8` fixture and `uploadFile(name, contents)` helper already defined in that file.

```ts
function teamJson(issuer = "ISS-TEAM") {
  return JSON.stringify({ key_id: "JKID", issuer_id: issuer, key: REAL_P8 });
}

it("upload a team JSON bundle: fills Key ID, Issuer ID, and .p8 contents", async () => {
  localStorage.clear();
  const { client } = makeClient();
  renderCard(client);
  await waitFor(() => screen.getByTestId("asc-p8-file"));
  uploadFile("AuthKey.json", teamJson());
  await waitFor(() =>
    expect((screen.getByTestId("asc-issuer-id") as HTMLInputElement).value).toBe("ISS-TEAM"),
  );
  expect((screen.getByTestId("asc-key-id") as HTMLInputElement).value).toBe("JKID");
  expect((screen.getByTestId("asc-p8") as HTMLTextAreaElement).value).toContain("BEGIN PRIVATE KEY");
});

it("upload a team JSON: bundle issuer_id overrides an existing field value", async () => {
  localStorage.setItem("store-ops:asc.issuerId", "OLD-REMEMBERED");
  const { client } = makeClient();
  renderCard(client);
  await waitFor(() => screen.getByTestId("asc-p8-file"));
  // starts pre-filled from memory
  await waitFor(() =>
    expect((screen.getByTestId("asc-issuer-id") as HTMLInputElement).value).toBe("OLD-REMEMBERED"),
  );
  uploadFile("AuthKey.json", teamJson("NEW-FROM-FILE"));
  await waitFor(() =>
    expect((screen.getByTestId("asc-issuer-id") as HTMLInputElement).value).toBe("NEW-FROM-FILE"),
  );
  localStorage.clear();
});

it("upload an individual JSON (no issuer_id): fills Key ID + .p8, does not clobber remembered Issuer ID", async () => {
  localStorage.setItem("store-ops:asc.issuerId", "KEEP-ME");
  const { client } = makeClient();
  renderCard(client);
  await waitFor(() => screen.getByTestId("asc-p8-file"));
  await waitFor(() =>
    expect((screen.getByTestId("asc-issuer-id") as HTMLInputElement).value).toBe("KEEP-ME"),
  );
  uploadFile("AuthKey.json", JSON.stringify({ key_id: "INDIV", key: REAL_P8 }));
  await waitFor(() =>
    expect((screen.getByTestId("asc-key-id") as HTMLInputElement).value).toBe("INDIV"),
  );
  expect((screen.getByTestId("asc-p8") as HTMLTextAreaElement).value).toContain("BEGIN PRIVATE KEY");
  // remembered issuer preserved, not cleared
  expect((screen.getByTestId("asc-issuer-id") as HTMLInputElement).value).toBe("KEEP-ME");
  localStorage.clear();
});

it("upload a {-leading non-key JSON: shows the JSON error, leaves fields unchanged", async () => {
  localStorage.clear();
  const { client } = makeClient();
  renderCard(client);
  await waitFor(() => screen.getByTestId("asc-p8-file"));
  uploadFile("bad.json", JSON.stringify({ hello: "world" }));
  await waitFor(() =>
    expect(screen.getByTestId("asc-p8-file-error").textContent).toContain(
      "isn't a valid API-key JSON",
    ),
  );
  expect((screen.getByTestId("asc-key-id") as HTMLInputElement).value).toBe("");
  expect((screen.getByTestId("asc-p8") as HTMLTextAreaElement).value).toBe("");
});

it("upload a .p8 still works (route-by-content regression)", async () => {
  localStorage.clear();
  const { client } = makeClient();
  renderCard(client);
  await waitFor(() => screen.getByTestId("asc-p8-file"));
  uploadFile("AuthKey_KID9.p8", REAL_P8);
  await waitFor(() =>
    expect((screen.getByTestId("asc-key-id") as HTMLInputElement).value).toBe("KID9"),
  );
  expect((screen.getByTestId("asc-p8") as HTMLTextAreaElement).value).toContain("BEGIN PRIVATE KEY");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud/web && npx vitest run src/features/appDetail/ConnectAscCard.test.tsx`
Expected: the new JSON tests FAIL (no routing yet); existing tests (including the `.p8` ones) still PASS.

- [ ] **Step 3: Implement the routing**

(a) Add `parseKeyBundleJson` to the existing import from `./ascKeyFile.js`:

```ts
import { parseKeyIdFromFilename, looksLikeEcPrivateKey, normalizeP8, parseKeyBundleJson } from "./ascKeyFile.js";
```

(b) Replace the body of `onFilePicked` (keep the signature and the `e.target.value = ""` / no-file guard) with a content-sniff branch:

```ts
async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  e.target.value = ""; // allow re-picking the same file
  if (!file) return;
  const text = await file.text();

  // Route by content, not extension: a JSON bundle starts with "{".
  if (text.trimStart().startsWith("{")) {
    const parsed = parseKeyBundleJson(text);
    if (!parsed.ok) {
      setFileError(
        "That file isn't a valid API-key JSON. Upload the .p8 or the JSON key file you exported.",
      );
      return;
    }
    setFileError("");
    setP8(parsed.bundle.key);
    setKeyId(parsed.bundle.keyId);
    // Present issuer_id is authoritative; absent (individual key) leaves the field as-is.
    if (parsed.bundle.issuerId) setIssuerId(parsed.bundle.issuerId);
    return;
  }

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

(c) Update the file input `accept` and the button label. Change `accept=".p8"` to `accept=".p8,.json"`, and the button text `Upload .p8` to `Upload key file`. Leave all three test IDs (`asc-p8-file`, `asc-p8-upload`, `asc-p8-file-error`) unchanged.

- [ ] **Step 4: Run the component suite to verify green**

Run: `cd cloud/web && npx vitest run src/features/appDetail/ConnectAscCard.test.tsx`
Expected: PASS — existing tests + the 5 new JSON tests.

- [ ] **Step 5: Typecheck**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/appDetail/ConnectAscCard.tsx cloud/web/src/features/appDetail/ConnectAscCard.test.tsx
git commit -m "feat(asc): accept a Fastlane API-key JSON in the upload, route by content"
```

---

## Task 3: Full web suite + typecheck gate

**Files:** none (verification only).

- [ ] **Step 1: Run the entire web test suite**

Run: `cd cloud/web && npx vitest run`
Expected: PASS — full suite green, no regressions.

- [ ] **Step 2: Typecheck the whole web workspace**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Lint (if defined)**

Run: `cd cloud/web && npm run lint --if-present`
Expected: clean, or no lint script (skip — the web workspace has none).

No commit — this is the final gate before the whole-branch review.

---

## Self-Review

- **Spec coverage:** JSON bundle format parse (Task 1: `parseKeyBundleJson`); required key_id/key, optional issuer_id, base64 support, reuse of `looksLikeEcPrivateKey`, ignore duration/in_house (Task 1 impl + tests); one control accepts both via content sniff (Task 2b, 2c `accept`); relabel button (2c); fill matrix incl. Issuer-ID override vs no-clobber (Task 2b routing + the three issuer tests); JSON error copy + fill-nothing-on-error (2b); `.p8` regression (2 test). Out-of-scope items (duration/in_house/export/drag-drop/connected re-key/server) — none introduced. ✅
- **Placeholder scan:** none — every step has concrete code/commands. ✅
- **Type consistency:** `parseKeyBundleJson`/`KeyBundle`/`KeyBundleResult` defined in Task 1 and consumed in Task 2 with matching shape (`parsed.ok`, `parsed.bundle.{keyId,issuerId,key}`). Storage key `store-ops:asc.issuerId`, test IDs, and both error strings match verbatim across tasks and the Global Constraints. ✅
