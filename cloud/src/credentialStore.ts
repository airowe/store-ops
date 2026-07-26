/**
 * Stored-credential store (#67 post-launch half) — the D1 + env glue over the
 * pure `credentialVault` envelope crypto. Design:
 * docs/prd/credential-storage/00-design.md.
 *
 * INVARIANTS enforced here:
 *   • write-only custody: `getCredentialMeta`/`listCredentialMeta` return
 *     metadata ONLY (never ciphertext, never plaintext). Plaintext is produced
 *     solely by `useCredential`, as a transient the caller consumes and drops.
 *   • the KEK lives in a Worker secret (CRED_KEK_V*), resolved here; D1 holds
 *     only the envelope. `credentialsEnabled(env)` is false when no KEK is set
 *     → the feature is honestly unavailable (routes 503, UI hides).
 *   • lazy KEK rotation: a read whose row.kek_version < current re-wraps the DEK
 *     under the new KEK (best-effort; a re-wrap failure never blocks the use).
 *   • missing-table tolerance (deploy-order window) → reads degrade to empty.
 */
import {
  importKek,
  openCredential,
  rewrapDek,
  sealCredential,
  type SealedCredential,
  type VaultContext,
} from "./crypto/credentialVault.js";
import type { Env } from "./index.js";

const uuid = () => crypto.randomUUID();

/**
 * The highest KEK version configured on this deployment, and its secret.
 * Exported so other envelope-sealed stores (e.g. `webhook_secrets`, see
 * src/d1.ts `saveWebhookSecret`/`getWebhookSecretByAscAppId`) reuse the SAME
 * KEK acquisition rather than re-deriving it.
 */
export function currentKek(env: Env): { version: number; b64: string } | null {
  if (env.CRED_KEK_V2) return { version: 2, b64: env.CRED_KEK_V2 };
  if (env.CRED_KEK_V1) return { version: 1, b64: env.CRED_KEK_V1 };
  return null;
}

/** The secret for a specific version (for opening/ rotating older rows). */
export function kekForVersion(env: Env, version: number): string | null {
  if (version === 2) return env.CRED_KEK_V2 ?? null;
  if (version === 1) return env.CRED_KEK_V1 ?? null;
  return null;
}

/** True when this deployment can store credentials (a KEK is configured). */
export function credentialsEnabled(env: Env): boolean {
  return currentKek(env) !== null;
}

export type CredentialMeta = {
  id: string;
  appId: string | null;
  kind: "asc" | "play" | "asa";
  keyId: string;
  issuerId: string;
  createdAt: string;
  lastUsedAt: string | null;
  kekVersion: number;
  /**
   * #372: false when this row's DEK cannot be unwrapped with the configured KEK
   * — the key is stored but no longer usable. Surfaces so the UI can say so
   * instead of advertising a key that will fail at push time.
   */
  readable: boolean;
};

type Row = {
  id: string;
  user_id: string;
  app_id: string | null;
  kind: "asc" | "play" | "asa";
  key_id: string;
  issuer_id: string;
  ciphertext: string;
  wrapped_dek: string;
  kek_version: number;
  created_at: string;
  last_used_at: string | null;
};

function isMissingTable(e: unknown): boolean {
  return e instanceof Error && /no such table/i.test(e.message);
}

/**
 * A stored row whose DEK cannot be unwrapped (#372). Two ways this happens:
 * the row's KEK version has no configured secret, or — the incident this class
 * was written for — CRED_KEK_V1 was REPLACED with a new value instead of a new
 * version being added as V2, so the configured secret is present but wrong.
 *
 * Typed rather than a raw AES-GCM OperationError so every caller can react
 * honestly: the sweep degrades to the public pass, and the UI can say "this key
 * can no longer be read" instead of offering a push that 500s.
 *
 * Carries the key's IDENTIFIERS only — never ciphertext or plaintext.
 */
export class CredentialUnreadableError extends Error {
  readonly name = "CredentialUnreadableError";
  constructor(
    readonly kind: "asc" | "play" | "asa",
    readonly keyId: string,
    readonly kekVersion: number,
  ) {
    super(
      `stored ${kind} key ${keyId} (sealed under KEK v${kekVersion}) can no longer be read — ` +
        `the key-encryption key it was sealed with is not the one configured. Re-connect the key.`,
    );
  }
}

/**
 * Whether this deployment can even attempt to open a row: false when the row's
 * KEK version has no secret configured. A configured-but-WRONG KEK cannot be
 * detected without attempting decryption, so this is a necessary — not
 * sufficient — condition, and `useCredential` remains the authority.
 */
function kekAvailableFor(env: Env, kekVersion: number): boolean {
  return kekForVersion(env, kekVersion) !== null;
}

function metaOf(r: Row, env?: Env): CredentialMeta {
  return {
    id: r.id,
    appId: r.app_id,
    kind: r.kind,
    keyId: r.key_id,
    issuerId: r.issuer_id,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    kekVersion: r.kek_version,
    // Absent env (internal callers that don't surface to a client) → assume
    // readable rather than inventing a false negative.
    readable: env ? kekAvailableFor(env, r.kek_version) : true,
  };
}

/** ctx used for AAD — "-" for the account-level (unlinked) case so it's stable. */
function ctxFor(userId: string, appId: string | null, kind: "asc" | "play" | "asa", kekVersion: number): VaultContext {
  return { userId, appId: appId ?? "-", kind, kekVersion };
}

/**
 * Save (or replace) a credential for (user, app, kind). Seals under the CURRENT
 * KEK; a fresh envelope every time (fresh DEK). Returns the metadata only.
 */
export async function saveCredential(
  env: Env,
  args: {
    userId: string;
    appId: string | null;
    kind: "asc" | "play" | "asa";
    keyId: string;
    issuerId: string;
    plaintext: string;
  },
): Promise<CredentialMeta> {
  const kek = currentKek(env);
  if (!kek) throw new Error("credential storage is not enabled on this deployment");
  const key = await importKek(kek.b64);
  const sealed = await sealCredential(
    key,
    args.plaintext,
    ctxFor(args.userId, args.appId, args.kind, kek.version),
  );
  const id = uuid();
  // Upsert on the UNIQUE(user, app, kind) — replacing rotates to a fresh DEK.
  await env.DB.prepare(
    `INSERT INTO stored_credentials
       (id, user_id, app_id, kind, key_id, issuer_id, ciphertext, wrapped_dek, kek_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, app_id, kind) DO UPDATE SET
       key_id = excluded.key_id, issuer_id = excluded.issuer_id,
       ciphertext = excluded.ciphertext, wrapped_dek = excluded.wrapped_dek,
       kek_version = excluded.kek_version, created_at = datetime('now'),
       last_used_at = NULL`,
  )
    .bind(id, args.userId, args.appId, args.kind, args.keyId, args.issuerId, sealed.ciphertext, sealed.wrappedDek, kek.version)
    .run();
  const row = await fetchRow(env, args.userId, args.appId, args.kind);
  return metaOf(row!);
}

async function fetchRow(env: Env, userId: string, appId: string | null, kind: "asc" | "play" | "asa"): Promise<Row | null> {
  const sql =
    appId === null
      ? "SELECT * FROM stored_credentials WHERE user_id = ? AND app_id IS NULL AND kind = ?"
      : "SELECT * FROM stored_credentials WHERE user_id = ? AND app_id = ? AND kind = ?";
  const stmt = appId === null ? env.DB.prepare(sql).bind(userId, kind) : env.DB.prepare(sql).bind(userId, appId, kind);
  return (await stmt.first<Row>()) ?? null;
}

/** Metadata for one credential, or null. Never returns ciphertext/plaintext. */
export async function getCredentialMeta(
  env: Env,
  userId: string,
  appId: string | null,
  kind: "asc" | "play" | "asa",
): Promise<CredentialMeta | null> {
  try {
    const row = await fetchRow(env, userId, appId, kind);
    return row ? metaOf(row) : null;
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

/**
 * All of a user's stored-credential metadata (for the management panel).
 *
 * #372: each row's `readable` is VERIFIED by attempting to unwrap its DEK, not
 * merely inferred from whether a KEK of that version is configured. The prod
 * incident was a configured-but-WRONG KEK — indistinguishable from a healthy
 * one until decryption is attempted — and reporting that row as healthy is what
 * let the UI offer a push that could not work.
 *
 * Only the DEK is unwrapped, never the payload, and no plaintext is produced
 * or returned. The cost is one AES-GCM unwrap per row on a management screen.
 */
export async function listCredentialMeta(env: Env, userId: string): Promise<CredentialMeta[]> {
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM stored_credentials WHERE user_id = ? ORDER BY created_at DESC",
    )
      .bind(userId)
      .all<Row>();
    return await Promise.all(
      (results ?? []).map(async (r) => ({ ...metaOf(r, env), readable: await dekOpens(env, r) })),
    );
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

/**
 * Can this row actually be opened with the configured KEK? The wrong-KEK case
 * fails at the DEK unwrap, which is the FIRST thing openCredential does, so
 * this detects it without needing a separate unwrap-only primitive.
 *
 * The plaintext produced here is deliberately dropped and never returned — this
 * function is boolean-valued precisely so no caller can obtain it. Any failure
 * (missing secret, wrong secret, tamper) reports "not readable" rather than
 * throwing: this backs a status flag, and a management screen must render even
 * when a row is broken.
 */
async function dekOpens(env: Env, r: Row): Promise<boolean> {
  const kekB64 = kekForVersion(env, r.kek_version);
  if (!kekB64) return false;
  try {
    const kek = await importKek(kekB64);
    await openCredential(kek, sealedOf(r), ctxFor(r.user_id, r.app_id, r.kind, r.kek_version));
    return true;
  } catch {
    return false;
  }
}

/** The envelope for a row, as the vault expects it. */
function sealedOf(r: Row): SealedCredential {
  return { ciphertext: r.ciphertext, wrappedDek: r.wrapped_dek, kekVersion: r.kek_version };
}

/** Delete a stored credential (does NOT revoke at Apple/Google). */
export async function deleteCredential(
  env: Env,
  userId: string,
  appId: string | null,
  kind: "asc" | "play" | "asa",
): Promise<boolean> {
  const sql =
    appId === null
      ? "DELETE FROM stored_credentials WHERE user_id = ? AND app_id IS NULL AND kind = ?"
      : "DELETE FROM stored_credentials WHERE user_id = ? AND app_id = ? AND kind = ?";
  const stmt = appId === null ? env.DB.prepare(sql).bind(userId, kind) : env.DB.prepare(sql).bind(userId, appId, kind);
  const res = await stmt.run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Decrypt a stored credential for USE (JWT minting / Play token exchange). The
 * plaintext is returned as a transient the caller consumes and drops — it is
 * never logged, cached, or returned to a client. Stamps last_used_at and lazily
 * re-wraps the DEK if the row is behind the current KEK version.
 *
 * Returns null when there is no stored credential (the caller falls back to the
 * per-run credential path).
 *
 * #372: when a row EXISTS but cannot be opened — its KEK version has no secret,
 * or the configured secret is the wrong one because CRED_KEK_V1 was replaced
 * rather than rotated to V2 — this throws CredentialUnreadableError. Typed, so
 * callers distinguish "no key" (fall back silently) from "a key you stored can
 * no longer be read" (tell the user, honestly). It is deliberately NOT folded
 * into `null`: silently treating a dead key as "never had one" would hide the
 * loss from the person who needs to re-connect it.
 */
export async function useCredential(
  env: Env,
  userId: string,
  appId: string | null,
  kind: "asc" | "play" | "asa",
): Promise<{ plaintext: string; meta: CredentialMeta } | null> {
  let row: Row | null;
  try {
    row = await fetchRow(env, userId, appId, kind);
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
  if (!row) return null;

  const rowKekB64 = kekForVersion(env, row.kek_version);
  if (!rowKekB64) {
    throw new CredentialUnreadableError(row.kind, row.key_id, row.kek_version);
  }
  const rowKek = await importKek(rowKekB64);
  const sealed: SealedCredential = sealedOf(row);
  // A WRONG (not merely missing) KEK surfaces here as a raw AES-GCM
  // OperationError. Translate it into the same typed failure so callers never
  // have to pattern-match on crypto internals to behave honestly.
  let plaintext: string;
  try {
    plaintext = await openCredential(rowKek, sealed, ctxFor(userId, appId, kind, row.kek_version));
  } catch {
    throw new CredentialUnreadableError(row.kind, row.key_id, row.kek_version);
  }

  // Stamp usage (best-effort).
  await env.DB.prepare("UPDATE stored_credentials SET last_used_at = datetime('now') WHERE id = ?")
    .bind(row.id)
    .run()
    .catch(() => undefined);

  // Lazy KEK rotation: if a newer KEK is configured, re-wrap now. Best-effort —
  // a rotation failure must never block the USE the caller needs.
  const cur = currentKek(env);
  if (cur && cur.version > row.kek_version) {
    try {
      const newKek = await importKek(cur.b64);
      const rotated = await rewrapDek(
        rowKek,
        newKek,
        sealed,
        { userId, appId: appId ?? "-", kind },
        cur.version,
      );
      await env.DB.prepare(
        "UPDATE stored_credentials SET ciphertext = ?, wrapped_dek = ?, kek_version = ? WHERE id = ?",
      )
        .bind(rotated.ciphertext, rotated.wrappedDek, cur.version, row.id)
        .run();
    } catch {
      /* rotation is opportunistic — the row stays on its old (valid) KEK */
    }
  }

  return { plaintext, meta: metaOf(row) };
}
