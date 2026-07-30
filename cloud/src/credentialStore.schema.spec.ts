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
  CredentialUnreadableError,
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

  /**
   * #372 — the KEK-replaced-in-place failure, reproduced.
   *
   * The vault's contract is that an unavailable credential is HONESTLY
   * unavailable. That was only ever implemented for "no KEK configured".
   * When a KEK is configured but is the WRONG one — the row was sealed under a
   * previous CRED_KEK_V1 that got overwritten rather than rotated to V2 —
   * AES-GCM throws a raw OperationError from deep inside openCredential.
   *
   * That is the exact prod incident: metadata still lists the key as healthy
   * (listCredentialMeta never decrypts), so the UI offers a push that cannot
   * possibly work, and cron/keyedSweep.ts calls useCredential OUTSIDE its try,
   * so the throw aborts the app's whole sweep instead of degrading to keyless.
   */
  describe("#372: a row sealed under a REPLACED KEK", () => {
    /** Seal a credential under one KEK, then hand back an env holding another. */
    async function sealedUnderStaleKek() {
      const OTHER_KEK = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 200)));
      await saveCredential(envWith(db, KEK), {
        userId: "u1", appId: "app1", kind: "asc", keyId: "NC235A8728", issuerId: "iss-1", plaintext: P8,
      });
      return envWith(db, OTHER_KEK);
    }

    it("fails as a typed, identifiable error — not a raw crypto OperationError", async () => {
      const env = await sealedUnderStaleKek();
      const err = await useCredential(env, "u1", "app1", "asc").catch((e: unknown) => e);
      // Asserted via instanceof rather than rejects.toThrow(Class): if the class
      // is ever absent/undefined, toThrow(undefined) matches ANY throw and the
      // test passes vacuously against the very bug it exists to catch.
      expect(CredentialUnreadableError).toBeTypeOf("function");
      expect(err).toBeInstanceOf(CredentialUnreadableError);
      expect((err as Error).name).toBe("CredentialUnreadableError");
    });

    it("the error names the key and says what to do, without leaking key material", async () => {
      const env = await sealedUnderStaleKek();
      const err = await useCredential(env, "u1", "app1", "asc").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CredentialUnreadableError);
      const e = err as CredentialUnreadableError;
      // identifies WHICH key, so a user can act on it
      expect(e.keyId).toBe("NC235A8728");
      expect(e.kind).toBe("asc");
      // and never carries ciphertext or plaintext
      expect(e.message).not.toContain("PRIVATE KEY");
      expect(e.message).not.toContain("MIISECRET");
    });

    /**
     * The honesty half: metadata reads must not keep advertising a key that can
     * no longer be used. `readable: false` lets Settings mark the row and
     * RunView withhold the push card, instead of offering an action that 500s.
     */
    it("metadata reports the row as UNREADABLE rather than healthy", async () => {
      const env = await sealedUnderStaleKek();
      const list = await listCredentialMeta(env, "u1");
      expect(list).toHaveLength(1);
      expect(list[0]!.keyId).toBe("NC235A8728");
      expect(list[0]!.readable).toBe(false);
    });

    it("a row under the CURRENT KEK is still reported readable", async () => {
      const env = envWith(db, KEK);
      await saveCredential(env, {
        userId: "u1", appId: "app1", kind: "asc", keyId: "ABC123", issuerId: "iss-1", plaintext: P8,
      });
      const list = await listCredentialMeta(env, "u1");
      expect(list[0]!.readable).toBe(true);
      // and the happy path is untouched
      expect((await useCredential(env, "u1", "app1", "asc"))?.plaintext).toBe(P8);
    });
  });

  /**
   * #372 second half — make the replaced-KEK case IDENTIFIABLE, not just
   * survivable. The first half made an unreadable row fail honestly; this makes
   * the system able to say WHY before it ever tries to decrypt.
   */
  describe("#372: KEK fingerprints", () => {
    const OTHER_KEK = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 200)));

    it("saving records which KEK sealed the row", async () => {
      const env = envWith(db, KEK);
      await saveCredential(env, {
        userId: "u1", appId: "app1", kind: "asc", keyId: "K", issuerId: "i", plaintext: P8,
      });
      const row = await db
        .prepare("SELECT kek_fingerprint FROM stored_credentials")
        .bind()
        .first<{ kek_fingerprint: string | null }>();
      expect(row?.kek_fingerprint).toMatch(/^[0-9a-f]{16}$/);
      // and it is emphatically not the key
      expect(row?.kek_fingerprint).not.toContain(KEK);
    });

    /**
     * The whole point: a row sealed under a REPLACED KEK is now identifiable
     * WITHOUT attempting a decrypt, so metadata reads can report it honestly.
     */
    it("metadata reports a fingerprint mismatch as unreadable", async () => {
      await saveCredential(envWith(db, KEK), {
        userId: "u1", appId: "app1", kind: "asc", keyId: "NC235A8728", issuerId: "i", plaintext: P8,
      });
      const list = await listCredentialMeta(envWith(db, OTHER_KEK), "u1");
      expect(list[0]!.readable).toBe(false);
    });

    /**
     * A row written before the migration has NULL — which means UNKNOWN, never
     * "mismatched". Reporting a legacy row as broken would be a fabricated
     * failure, the exact class of error this column exists to prevent.
     */
    it("a NULL fingerprint is treated as unknown, not as a mismatch", async () => {
      const env = envWith(db, KEK);
      await saveCredential(env, {
        userId: "u1", appId: "app1", kind: "asc", keyId: "K", issuerId: "i", plaintext: P8,
      });
      await db.prepare("UPDATE stored_credentials SET kek_fingerprint = NULL").bind().run();
      // still readable: the DEK genuinely opens, and that is what decides
      const list = await listCredentialMeta(env, "u1");
      expect(list[0]!.readable).toBe(true);
      expect((await useCredential(env, "u1", "app1", "asc"))?.plaintext).toBe(P8);
    });

    it("a legacy NULL row backfills its fingerprint on the next successful use", async () => {
      const env = envWith(db, KEK);
      await saveCredential(env, {
        userId: "u1", appId: "app1", kind: "asc", keyId: "K", issuerId: "i", plaintext: P8,
      });
      await db.prepare("UPDATE stored_credentials SET kek_fingerprint = NULL").bind().run();
      await useCredential(env, "u1", "app1", "asc");
      const row = await db
        .prepare("SELECT kek_fingerprint FROM stored_credentials")
        .bind()
        .first<{ kek_fingerprint: string | null }>();
      expect(row?.kek_fingerprint).toMatch(/^[0-9a-f]{16}$/);
    });

    /**
     * What the fingerprint uniquely buys, over the decrypt-fallback from the
     * first half of #372: the mismatch is decided WITHOUT crypto.
     *
     * Proven by making the decrypt path impossible to reach a verdict through —
     * a KEK whose fingerprint differs but which is NOT a valid AES key would
     * throw inside importKek rather than returning a clean false. Only the
     * fingerprint check, which runs first and never imports, answers honestly.
     */
    it("decides a mismatch from the fingerprint alone, before any key import", async () => {
      await saveCredential(envWith(db, KEK), {
        userId: "u1", appId: "app1", kind: "asc", keyId: "K", issuerId: "i", plaintext: P8,
      });
      // Record a fingerprint that cannot match the configured KEK.
      await db
        .prepare("UPDATE stored_credentials SET kek_fingerprint = 'deadbeefdeadbeef'")
        .bind()
        .run();
      const list = await listCredentialMeta(envWith(db, KEK), "u1");
      expect(list[0]!.readable).toBe(false);
      // the row is still described honestly rather than vanishing
      expect(list[0]!.keyId).toBe("K");
      // and useCredential refuses with the typed error, not a crypto error
      const err = await useCredential(envWith(db, KEK), "u1", "app1", "asc").catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(CredentialUnreadableError);
    });

    it("the error names the fingerprint mismatch so an operator can diagnose it", async () => {
      await saveCredential(envWith(db, KEK), {
        userId: "u1", appId: "app1", kind: "asc", keyId: "NC235A8728", issuerId: "i", plaintext: P8,
      });
      const err = await useCredential(envWith(db, OTHER_KEK), "u1", "app1", "asc").catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(CredentialUnreadableError);
      expect((err as Error).message).toMatch(/sealed under a different key|key-encryption key/i);
    });
  });

  it("DEPLOY ORDER: a DB without the table degrades reads to empty/null", async () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    const noTable = schema
      // Match to the statement terminator at a line start, not the first ");" —
      // a parenthesis inside a COLUMN COMMENT used to truncate this mid-CREATE,
      // producing a "syntax error" that looked like a schema bug rather than a
      // parser bug. (#372 hit exactly that.)
      .replace(/CREATE TABLE IF NOT EXISTS stored_credentials[\s\S]*?\n\);/, "")
      .replace(/CREATE INDEX IF NOT EXISTS idx_stored_cred_user[^;]*;/, "");
    const bare = envWith(d1From(noTable), KEK);
    expect(await listCredentialMeta(bare, "u1")).toEqual([]);
    expect(await useCredential(bare, "u1", "app1", "asc")).toBeNull();
  });
});
