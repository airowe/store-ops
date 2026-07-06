/**
 * Stored credentials against the REAL schema (#67) — node:sqlite over the
 * actual schema.sql. Pins: save→use round-trip, write-only metadata (no
 * ciphertext/plaintext escapes), replace rotates the DEK, delete, the honest
 * account-level (NULL app) case, missing-table/no-KEK degrade, and that a D1
 * dump exposes only ciphertext.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  credentialsEnabled,
  deleteCredential,
  getCredentialMeta,
  listCredentialMeta,
  saveCredential,
  useCredential,
} from "./credentialStore.js";
import type { Env } from "./index.js";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const sqliteAvailable = DatabaseSync !== null;
const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);

function d1From(sql: string): D1Database {
  const sqlite = new DatabaseSync!(":memory:");
  sqlite.exec(sql);
  return {
    prepare(stmtSql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          return (sqlite.prepare(stmtSql).get(...(bound as never[])) ?? null) as T | null;
        },
        async run() {
          const info = sqlite.prepare(stmtSql).run(...(bound as never[]));
          return { success: true, meta: { changes: Number(info.changes) } } as never;
        },
        async all<T>() {
          return { results: sqlite.prepare(stmtSql).all(...(bound as never[])) as T[] } as never;
        },
      };
      return stmt as never;
    },
  } as unknown as D1Database;
}

// a valid base64 32-byte KEK
const KEK = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 7)));
const P8 = "-----BEGIN PRIVATE KEY-----\nMIISECRETbytes\n-----END PRIVATE KEY-----";

function envWith(db: D1Database, kek?: string): Env {
  return { DB: db, ...(kek ? { CRED_KEK_V1: kek } : {}) } as unknown as Env;
}

let db: D1Database;
beforeEach(async () => {
  if (!sqliteAvailable) return;
  db = d1From(readFileSync(SCHEMA_PATH, "utf8"));
  await db.prepare("INSERT INTO users (id, email) VALUES ('u1', 'a@b.co')").bind().run();
  await db.prepare("INSERT INTO apps (id, user_id, bundle_id, name) VALUES ('app1','u1','com.x.y','X')").bind().run();
});

describe.skipIf(!sqliteAvailable)("stored credentials against the real schema (#67)", () => {
  it("no KEK → feature disabled; reads still degrade to empty", async () => {
    const env = envWith(db);
    expect(credentialsEnabled(env)).toBe(false);
    expect(await listCredentialMeta(env, "u1")).toEqual([]);
    expect(await useCredential(env, "u1", "app1", "asc")).toBeNull();
  });

  it("save → use round-trips the plaintext; metadata carries the identifiers only", async () => {
    const env = envWith(db, KEK);
    const meta = await saveCredential(env, {
      userId: "u1", appId: "app1", kind: "asc", keyId: "ABC123", issuerId: "iss-1", plaintext: P8,
    });
    expect(meta.keyId).toBe("ABC123");
    expect(meta.kekVersion).toBe(1);
    const used = await useCredential(env, "u1", "app1", "asc");
    expect(used?.plaintext).toBe(P8);
    expect(used?.meta.keyId).toBe("ABC123");
  });

  it("WRITE-ONLY: neither the metadata nor a raw D1 dump exposes plaintext", async () => {
    const env = envWith(db, KEK);
    await saveCredential(env, { userId: "u1", appId: "app1", kind: "asc", keyId: "ABC123", issuerId: "iss-1", plaintext: P8 });

    const list = JSON.stringify(await listCredentialMeta(env, "u1"));
    expect(list).not.toContain("PRIVATE KEY");
    expect(list).not.toContain("MIISECRET");
    expect(list).not.toContain("ciphertext");

    // a full table dump (the "D1 leaked" threat) exposes only ciphertext
    const { results } = await db.prepare("SELECT * FROM stored_credentials").bind().all<Record<string, unknown>>();
    const dump = JSON.stringify(results);
    expect(dump).not.toContain("PRIVATE KEY");
    expect(dump).not.toContain("MIISECRET");
    expect(dump).toContain("ciphertext" in results![0]! ? String(results![0]!.ciphertext).slice(0, 6) : "");
  });

  it("replace rotates to a fresh envelope (new ciphertext) and updates identifiers", async () => {
    const env = envWith(db, KEK);
    await saveCredential(env, { userId: "u1", appId: "app1", kind: "asc", keyId: "OLD", issuerId: "iss-1", plaintext: P8 });
    const first = (await db.prepare("SELECT ciphertext FROM stored_credentials WHERE key_id='OLD'").bind().first<{ ciphertext: string }>());
    await saveCredential(env, { userId: "u1", appId: "app1", kind: "asc", keyId: "NEW", issuerId: "iss-2", plaintext: "different-key" });
    const meta = await getCredentialMeta(env, "u1", "app1", "asc");
    expect(meta?.keyId).toBe("NEW"); // UNIQUE(user,app,kind) upsert — one row
    const second = (await db.prepare("SELECT ciphertext FROM stored_credentials WHERE key_id='NEW'").bind().first<{ ciphertext: string }>());
    expect(second!.ciphertext).not.toBe(first!.ciphertext);
    expect((await useCredential(env, "u1", "app1", "asc"))?.plaintext).toBe("different-key");
  });

  it("account-level (NULL app) credential is distinct from an app-linked one", async () => {
    const env = envWith(db, KEK);
    await saveCredential(env, { userId: "u1", appId: null, kind: "asc", keyId: "ACCT", issuerId: "iss", plaintext: "acct-key" });
    await saveCredential(env, { userId: "u1", appId: "app1", kind: "asc", keyId: "APP", issuerId: "iss", plaintext: "app-key" });
    expect((await useCredential(env, "u1", null, "asc"))?.plaintext).toBe("acct-key");
    expect((await useCredential(env, "u1", "app1", "asc"))?.plaintext).toBe("app-key");
    expect(await listCredentialMeta(env, "u1")).toHaveLength(2);
  });

  it("delete removes the row and reports it; a ghost delete is false", async () => {
    const env = envWith(db, KEK);
    await saveCredential(env, { userId: "u1", appId: "app1", kind: "asc", keyId: "K", issuerId: "i", plaintext: P8 });
    expect(await deleteCredential(env, "u1", "app1", "asc")).toBe(true);
    expect(await getCredentialMeta(env, "u1", "app1", "asc")).toBeNull();
    expect(await deleteCredential(env, "u1", "app1", "asc")).toBe(false);
  });

  it("DEPLOY ORDER: a DB without the table degrades reads to empty/null", async () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    const noTable = schema
      .replace(/CREATE TABLE IF NOT EXISTS stored_credentials[\s\S]*?\);/, "")
      .replace(/CREATE INDEX IF NOT EXISTS idx_stored_cred_user[^;]*;/, "");
    const bare = envWith(d1From(noTable), KEK);
    expect(await listCredentialMeta(bare, "u1")).toEqual([]);
    expect(await useCredential(bare, "u1", "app1", "asc")).toBeNull();
  });
});
