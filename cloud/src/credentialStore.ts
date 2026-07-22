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

function metaOf(r: Row): CredentialMeta {
  return {
    id: r.id,
    appId: r.app_id,
    kind: r.kind,
    keyId: r.key_id,
    issuerId: r.issuer_id,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    kekVersion: r.kek_version,
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

/** All of a user's stored-credential metadata (for the management panel). */
export async function listCredentialMeta(env: Env, userId: string): Promise<CredentialMeta[]> {
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM stored_credentials WHERE user_id = ? ORDER BY created_at DESC",
    )
      .bind(userId)
      .all<Row>();
    return (results ?? []).map(metaOf);
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
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
 * per-run credential path). Throws only on a genuine decrypt failure (tamper /
 * a KEK version whose secret is missing) — an operator-visible error.
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
    throw new Error(`stored credential sealed under KEK v${row.kek_version}, whose secret is not configured`);
  }
  const rowKek = await importKek(rowKekB64);
  const sealed: SealedCredential = {
    ciphertext: row.ciphertext,
    wrappedDek: row.wrapped_dek,
    kekVersion: row.kek_version,
  };
  const plaintext = await openCredential(rowKek, sealed, ctxFor(userId, appId, kind, row.kek_version));

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
