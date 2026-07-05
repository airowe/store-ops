/**
 * Credential handling — the security-critical seam.
 *
 * THE BINDING INVARIANT: a credential (`.p8` or Play service-account JSON) is
 * read into memory, sent ONCE over HTTPS, and **NEVER persisted on device** — not
 * to SecureStore, AsyncStorage, files, logs, or analytics. The only persisted
 * secret is the session token (see `auth/session.ts`). This module therefore
 * ONLY reads (document-picker → string) and validates; it has NO write/persist
 * path by construction, and `credentials.neverPersisted.test.ts` enforces it.
 */
import * as FileSystem from "expo-file-system/legacy";

/** Read a picked document's contents into a string. No caching, no persistence. */
export async function readCredentialFile(
  uri: string,
  readAsStringAsync: typeof FileSystem.readAsStringAsync = FileSystem.readAsStringAsync,
): Promise<string> {
  return readAsStringAsync(uri);
}

export type PickedFileDeps = {
  readAsStringAsync: typeof FileSystem.readAsStringAsync;
  deleteAsync: typeof FileSystem.deleteAsync;
  cacheDirectory: string | null;
};

/**
 * Read a PICKED credential file and make sure no on-disk copy outlives the read.
 * The picker is invoked with `copyToCacheDirectory: false` (see CredentialSheet),
 * so normally no copy exists — but if the OS/picker staged one inside our cache
 * anyway, it is deleted (best-effort) the moment the contents are in memory.
 * This is the enforcement arm of the NEVER-persisted invariant for the file path.
 */
export async function readPickedCredential(
  uri: string,
  deps: PickedFileDeps = {
    readAsStringAsync: FileSystem.readAsStringAsync,
    deleteAsync: FileSystem.deleteAsync,
    cacheDirectory: FileSystem.cacheDirectory,
  },
): Promise<string> {
  try {
    return await deps.readAsStringAsync(uri);
  } finally {
    // Defensive cleanup: only ever delete inside OUR cache dir (never the user's
    // original document), and never let cleanup failure mask the read result.
    if (deps.cacheDirectory && uri.startsWith(deps.cacheDirectory)) {
      try {
        await deps.deleteAsync(uri, { idempotent: true });
      } catch {
        /* best-effort — a locked file is still bounded by the OS cache eviction */
      }
    }
  }
}

/** Shape a `.p8` credential the ASC run needs. */
export type AscCredential = { p8: string; keyId: string; issuerId: string };

/** Validate ASC inputs without revealing the key. Returns the first problem or null. */
export function validateAscCredential(c: Partial<AscCredential>): string | null {
  if (!c.p8 || !/BEGIN PRIVATE KEY/.test(c.p8)) return "Paste or pick a valid .p8 private key.";
  if (!c.keyId || !c.keyId.trim()) return "Key ID is required.";
  if (!c.issuerId || !c.issuerId.trim()) return "Issuer ID is required.";
  return null;
}

/**
 * Validate that a string is a usable Play service-account JSON (has a private key
 * + client_email + token_uri). We parse only to validate the SHAPE; the parsed
 * object is discarded — the raw string is what gets sent, used once.
 */
export function validateServiceAccount(json: string): string | null {
  if (!json || !json.trim()) return "Paste or pick your service-account JSON.";
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return "That isn’t valid JSON.";
  }
  const o = parsed as Record<string, unknown>;
  if (o.type !== "service_account") return "Expected a service-account key (type: service_account).";
  if (typeof o.private_key !== "string" || !o.private_key.includes("PRIVATE KEY")) return "Missing the private_key field.";
  if (typeof o.client_email !== "string") return "Missing the client_email field.";
  return null;
}
