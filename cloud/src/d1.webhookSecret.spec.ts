/**
 * Webhook secret storage (Task 5 security fix) — the secret is SEALED at rest
 * via the SAME KEK/DEK envelope crypto as `stored_credentials`
 * (src/crypto/credentialVault.ts), not plaintext. Pins: save→read round-trip
 * recovers the original secret, and a raw D1 dump of the row never contains
 * the plaintext secret — only ciphertext/wrapped_dek.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { getWebhookSecretByAscAppId, saveWebhookSecret } from "./d1.js";
import type { Env } from "./index.js";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const sqliteAvailable = DatabaseSync !== null;
const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);
const MIGRATION_PATH = fileURLToPath(new URL("../migrations/0008_webhook_secrets.sql", import.meta.url).href);

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
const KEK = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 11)));
const SECRET = "whsec_super-sensitive-hmac-secret-value";

function envWith(db: D1Database, kek?: string): Env {
  return { DB: db, ...(kek ? { CRED_KEK_V1: kek } : {}) } as unknown as Env;
}

let db: D1Database;
beforeEach(async () => {
  if (!sqliteAvailable) return;
  const sql = readFileSync(SCHEMA_PATH, "utf8") + "\n" + readFileSync(MIGRATION_PATH, "utf8");
  db = d1From(sql);
  await db.prepare("INSERT INTO users (id, email) VALUES ('u1', 'a@b.co')").bind().run();
  await db.prepare("INSERT INTO apps (id, user_id, bundle_id, name) VALUES ('app1','u1','com.x.y','X')").bind().run();
});

describe.skipIf(!sqliteAvailable)("webhook secret storage — sealed via KEK/DEK envelope", () => {
  it("no KEK configured → save throws a clear operator error", async () => {
    const env = envWith(db);
    await expect(
      saveWebhookSecret(env, { ascAppId: "6446", appId: "app1", secret: SECRET }),
    ).rejects.toThrow(/credential storage is not enabled/);
  });

  it("save → read round-trips the original plaintext secret", async () => {
    const env = envWith(db, KEK);
    await saveWebhookSecret(env, { ascAppId: "6446", appId: "app1", secret: SECRET });
    const resolved = await getWebhookSecretByAscAppId(env, "6446");
    expect(resolved).not.toBeNull();
    expect(resolved!.secret).toBe(SECRET);
    expect(resolved!.app.id).toBe("app1");
  });

  it("SEALED AT REST: the stored row never contains the plaintext secret", async () => {
    const env = envWith(db, KEK);
    await saveWebhookSecret(env, { ascAppId: "6446", appId: "app1", secret: SECRET });

    const row = await db
      .prepare("SELECT * FROM webhook_secrets WHERE asc_app_id = ?")
      .bind("6446")
      .first<Record<string, unknown>>();
    expect(row).toBeTruthy();
    const dump = JSON.stringify(row);
    expect(dump).not.toContain(SECRET);
    expect(row!.ciphertext).toBeTruthy();
    expect(row!.wrapped_dek).toBeTruthy();
    expect(row!.kek_version).toBe(1);
  });

  it("re-saving rotates to a fresh envelope (new ciphertext) for the same app id", async () => {
    const env = envWith(db, KEK);
    await saveWebhookSecret(env, { ascAppId: "6446", appId: "app1", secret: SECRET });
    const first = await db.prepare("SELECT ciphertext FROM webhook_secrets WHERE asc_app_id = ?").bind("6446").first<{ ciphertext: string }>();
    await saveWebhookSecret(env, { ascAppId: "6446", appId: "app1", secret: "whsec_rotated-value" });
    const second = await db.prepare("SELECT ciphertext FROM webhook_secrets WHERE asc_app_id = ?").bind("6446").first<{ ciphertext: string }>();
    expect(second!.ciphertext).not.toBe(first!.ciphertext);
    expect((await getWebhookSecretByAscAppId(env, "6446"))!.secret).toBe("whsec_rotated-value");
  });

  it("no secret on file → null, not an error", async () => {
    const env = envWith(db, KEK);
    expect(await getWebhookSecretByAscAppId(env, "unregistered")).toBeNull();
  });

  it("a row sealed under a KEK version whose secret is missing throws (not a broken secret)", async () => {
    const env = envWith(db, KEK);
    await saveWebhookSecret(env, { ascAppId: "6446", appId: "app1", secret: SECRET });
    // simulate the v1 KEK secret having been rotated OUT of the environment
    const noKekEnv = envWith(db);
    await expect(getWebhookSecretByAscAppId(noKekEnv, "6446")).rejects.toThrow(/kek_version|KEK/i);
  });

  it("DEPLOY ORDER: a DB without the webhook_secrets table degrades reads to null", async () => {
    const bareSql = readFileSync(SCHEMA_PATH, "utf8");
    const bare = envWith(d1From(bareSql), KEK);
    await bare.DB.prepare("INSERT INTO users (id, email) VALUES ('u1', 'a@b.co')").bind().run();
    expect(await getWebhookSecretByAscAppId(bare, "6446")).toBeNull();
  });
});
