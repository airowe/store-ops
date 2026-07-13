/**
 * Scoped API keys (#93). The security-load-bearing invariants:
 *   • the raw key is NEVER stored — only its SHA-256 hash (a DB leak is useless),
 *   • a key resolves to exactly its owner, and only via a hash match,
 *   • revoke is scoped to the owner (you can't delete someone else's key),
 *   • a malformed/unknown bearer resolves to null (fail-closed).
 */
import { describe, expect, it } from "vitest";
import {
  createApiKey,
  generateApiKey,
  hashApiKey,
  listApiKeys,
  looksLikeApiKey,
  resolveApiKey,
  revokeApiKey,
} from "./apiKeys.js";

type Row = {
  id: string;
  user_id: string;
  label: string;
  prefix: string;
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
};

/** Minimal in-memory D1 covering exactly the statements apiKeys.ts issues. */
function fakeDb(users: Array<{ id: string; email: string }> = []) {
  const rows: Row[] = [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  function stmt(sql: string) {
    let args: unknown[] = [];
    return {
      bind(...a: unknown[]) {
        args = a;
        return this;
      },
      async run() {
        if (sql.startsWith("INSERT INTO api_keys")) {
          const [id, user_id, label, prefix, key_hash, created_at] = args as [string, string, string, string, string, string];
          rows.push({ id, user_id, label, prefix, key_hash, created_at, last_used_at: null });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM api_keys")) {
          const [id, user_id] = args as [string, string];
          const before = rows.length;
          for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i]!.id === id && rows[i]!.user_id === user_id) rows.splice(i, 1);
          }
          return { success: true, meta: { changes: before - rows.length } };
        }
        if (sql.startsWith("UPDATE api_keys SET last_used_at")) {
          const [ts, id] = args as [string, string];
          const row = rows.find((r) => r.id === id);
          if (row) row.last_used_at = ts;
          return { success: true, meta: { changes: row ? 1 : 0 } };
        }
        return { success: true, meta: { changes: 0 } };
      },
      async all<T>() {
        const [user_id] = args as [string];
        const results = rows
          .filter((r) => r.user_id === user_id)
          .map((r) => ({
            id: r.id,
            label: r.label,
            prefix: r.prefix,
            created_at: r.created_at,
            last_used_at: r.last_used_at,
          }));
        return { results: results as T[] };
      },
      async first<T>() {
        const [key_hash] = args as [string];
        const k = rows.find((r) => r.key_hash === key_hash);
        if (!k) return null;
        const u = userMap.get(k.user_id);
        if (!u) return null;
        return { key_id: k.id, user_id: u.id, email: u.email } as T;
      },
    };
  }
  return { db: { prepare: (sql: string) => stmt(sql) } as unknown as D1Database, rows };
}

describe("apiKeys — key shape + hashing", () => {
  it("generates a shipaso_ key with 48 hex chars of entropy", () => {
    const k = generateApiKey();
    expect(k.startsWith("shipaso_")).toBe(true);
    expect(k.length).toBe("shipaso_".length + 48);
    expect(k.slice("shipaso_".length)).toMatch(/^[0-9a-f]{48}$/);
    expect(generateApiKey()).not.toBe(k); // unique
  });

  it("looksLikeApiKey guards shape before any DB hit", () => {
    expect(looksLikeApiKey(generateApiKey())).toBe(true);
    expect(looksLikeApiKey("nope")).toBe(false);
    expect(looksLikeApiKey("shipaso_short")).toBe(false);
    expect(looksLikeApiKey("bearer_" + "a".repeat(48))).toBe(false);
  });

  it("hashApiKey is deterministic 64-hex and differs per key", async () => {
    const a = generateApiKey();
    expect(await hashApiKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashApiKey(a)).toBe(await hashApiKey(a));
    expect(await hashApiKey(a)).not.toBe(await hashApiKey(generateApiKey()));
  });
});

describe("apiKeys — store (create/list/resolve/revoke)", () => {
  it("stores ONLY the hash — never the raw key — and returns the raw once", async () => {
    const { db, rows } = fakeDb([{ id: "u1", email: "a@b.co" }]);
    const created = await createApiKey(db, "u1", "Claude Code");
    expect(created.key.startsWith("shipaso_")).toBe(true);
    expect(created.prefix.endsWith("…")).toBe(true);
    // the persisted row holds the HASH, not the raw key
    expect(rows[0]!.key_hash).toBe(await hashApiKey(created.key));
    expect(rows[0]!.key_hash).not.toBe(created.key);
    expect(JSON.stringify(rows[0])).not.toContain(created.key);
  });

  it("lists metadata only (no hash, no raw key)", async () => {
    const { db } = fakeDb([{ id: "u1", email: "a@b.co" }]);
    const created = await createApiKey(db, "u1", "CI bot");
    const list = await listApiKeys(db, "u1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, label: "CI bot", prefix: created.prefix });
    expect(JSON.stringify(list)).not.toContain("key_hash");
    expect(JSON.stringify(list)).not.toContain(created.key);
  });

  it("resolves a valid key to its owner and touches last_used_at", async () => {
    const { db, rows } = fakeDb([{ id: "u1", email: "owner@x.co" }]);
    const created = await createApiKey(db, "u1", "");
    const who = await resolveApiKey(db, created.key);
    expect(who).toEqual({ id: "u1", email: "owner@x.co" });
    expect(rows[0]!.last_used_at).not.toBeNull();
  });

  it("fails closed on a wrong/malformed/unknown key", async () => {
    const { db } = fakeDb([{ id: "u1", email: "owner@x.co" }]);
    await createApiKey(db, "u1", "");
    expect(await resolveApiKey(db, "not-a-key")).toBeNull();
    expect(await resolveApiKey(db, generateApiKey())).toBeNull(); // valid shape, unknown hash
    expect(await resolveApiKey(db, "shipaso_short")).toBeNull();
  });

  it("revoke is scoped to the owner and idempotent", async () => {
    const { db } = fakeDb([{ id: "u1", email: "a@b.co" }]);
    const created = await createApiKey(db, "u1", "");
    // another user can't revoke it
    expect(await revokeApiKey(db, "u2", created.id)).toBe(false);
    expect(await resolveApiKey(db, created.key)).not.toBeNull();
    // owner revokes → gone, and a valid key no longer resolves
    expect(await revokeApiKey(db, "u1", created.id)).toBe(true);
    expect(await resolveApiKey(db, created.key)).toBeNull();
    expect(await revokeApiKey(db, "u1", created.id)).toBe(false); // already gone
  });
});
