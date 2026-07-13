/**
 * Scoped API keys ("shipaso_…") — how an external AI agent authenticates to the
 * MCP endpoint (/mcp) without the browser's session cookie.
 *
 * Custody discipline (mirrors the credential vault, #67): the raw key is shown
 * ONCE at creation and is NEVER stored — we persist only its SHA-256 hash, so a
 * DB leak yields no usable key, and we never log the raw value. Each key is
 * scoped to one user, labelled, listable by a non-secret prefix, and
 * independently REVOCABLE (deleting it kills agent access without touching the
 * session cookie, and doesn't weaken the HttpOnly-cookie protection).
 *
 * Downstream, the MCP tool registry is read/draft-only by construction
 * (tools.spec) — a key can audit + propose but can NEVER push. No store-writing
 * surface is reachable with one.
 */

/** Non-secret metadata for the management UI — the raw key is never in here. */
export type ApiKeyMeta = {
  id: string;
  label: string;
  /** non-secret display prefix, e.g. "shipaso_1a2b3c4d…" — never the full key. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/** Returned ONCE, at creation — the only time the raw `key` ever leaves the server. */
export type ApiKeyCreated = ApiKeyMeta & { key: string };

const KEY_PREFIX = "shipaso_";
const RAW_BYTES = 24; // → 48 hex chars of entropy after the prefix

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** A fresh, high-entropy key: `shipaso_` + 48 hex chars. */
export function generateApiKey(): string {
  const bytes = new Uint8Array(RAW_BYTES);
  crypto.getRandomValues(bytes);
  return KEY_PREFIX + toHex(bytes);
}

/** Cheap shape guard before a DB hash lookup — a well-formed ShipASO key. */
export function looksLikeApiKey(s: string): boolean {
  return s.startsWith(KEY_PREFIX) && s.length === KEY_PREFIX.length + RAW_BYTES * 2;
}

/** SHA-256 hex of the raw key — the ONLY form we persist or compare. */
export async function hashApiKey(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return toHex(new Uint8Array(buf));
}

/** The non-secret display prefix (the `shipaso_` tag + first 8 hex chars). */
function prefixOf(raw: string): string {
  return raw.slice(0, KEY_PREFIX.length + 8) + "…";
}

/** Mint a key for a user, store ONLY its hash, and return the raw key ONCE. */
export async function createApiKey(
  db: D1Database,
  userId: string,
  label: string,
): Promise<ApiKeyCreated> {
  const raw = generateApiKey();
  const id = crypto.randomUUID();
  const prefix = prefixOf(raw);
  const keyHash = await hashApiKey(raw);
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO api_keys (id, user_id, label, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, userId, label, prefix, keyHash, createdAt)
    .run();
  return { id, label, prefix, createdAt, lastUsedAt: null, key: raw };
}

/** This user's keys — metadata only (prefix, never the hash or the raw key). */
export async function listApiKeys(db: D1Database, userId: string): Promise<ApiKeyMeta[]> {
  const res = await db
    .prepare(
      "SELECT id, label, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(userId)
    .all<{ id: string; label: string; prefix: string; created_at: string; last_used_at: string | null }>();
  return (res.results ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

/** Revoke one of THIS user's keys (scoped, so a user can't delete another's). */
export async function revokeApiKey(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db
    .prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Resolve a presented bearer to its owning user, or null. Verifies by HASH
 * lookup (the raw key is never stored or compared in the clear). Best-effort
 * touches last_used_at. Fail-closed: a malformed or unknown key returns null,
 * never a user.
 */
export async function resolveApiKey(
  db: D1Database,
  raw: string,
): Promise<{ id: string; email: string } | null> {
  if (!looksLikeApiKey(raw)) return null;
  const keyHash = await hashApiKey(raw);
  const row = await db
    .prepare(
      "SELECT k.id AS key_id, u.id AS user_id, u.email AS email FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?",
    )
    .bind(keyHash)
    .first<{ key_id: string; user_id: string; email: string }>();
  if (!row) return null;
  // best-effort freshness; never fail auth on a touch error
  try {
    await db
      .prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), row.key_id)
      .run();
  } catch {
    /* a failed touch must never deny a valid key */
  }
  return { id: row.user_id, email: row.email };
}
