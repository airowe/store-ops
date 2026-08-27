/**
 * Approval challenges on the REAL composed schema.
 *
 * The load-bearing property is single-use: a challenge that has been spent must
 * never spend again. A mock returning canned rows would happily "pass" a
 * consume that forgot to mark anything, so this builds real SQLite and asserts
 * on what actually comes back after a spend.
 *
 * The negative controls are the point — replay, expiry, wrong run, wrong user,
 * and unknown value each get a test, because a consume that cannot return null
 * is not a gate.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  consumeApprovalChallenge,
  issueApprovalChallenge,
  upsertUser,
} from "./d1.js";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const sqliteAvailable = DatabaseSync !== null;

const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url).href);

function d1(): D1Database {
  const sqlite = new DatabaseSync!(":memory:");
  sqlite.exec(readFileSync(SCHEMA_PATH, "utf8"));
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
  }
  function makeStmt(sql: string) {
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; return stmt; },
      async first<T>() { return (sqlite.prepare(sql).get(...(bound as never[])) ?? null) as T | null; },
      async run() {
        const r = sqlite.prepare(sql).run(...(bound as never[]));
        return { success: true, meta: { changes: Number(r.changes) } };
      },
      async all<T>() { return { results: sqlite.prepare(sql).all(...(bound as never[])) as T[] }; },
    };
    return stmt;
  }
  return { prepare: makeStmt } as unknown as D1Database;
}

const RUN = "11111111-2222-4333-8444-555555555555";

async function seed() {
  const db = d1();
  const user = await upsertUser(db, "owner@example.com");
  await db.prepare("INSERT INTO apps (id, user_id, bundle_id, name, country) VALUES (?, ?, ?, ?, ?)")
    .bind("app_1", user.id, "com.acme.app", "Acme", "US").run();
  await db.prepare("INSERT INTO runs (id, app_id, status) VALUES (?, ?, ?)")
    .bind(RUN, "app_1", "awaiting_approval").run();
  return { db, userId: user.id };
}

describe.skipIf(!sqliteAvailable)("approval challenges", () => {
  it("issues an opaque challenge bound to the run and user", async () => {
    const { db, userId } = await seed();
    const c = await issueApprovalChallenge(db, { runId: RUN, userId });
    expect(typeof c).toBe("string");
    // Long enough that guessing is not a strategy; no separators to split on.
    expect(c.length).toBeGreaterThanOrEqual(20);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("consumes a fresh challenge exactly once", async () => {
    const { db, userId } = await seed();
    const c = await issueApprovalChallenge(db, { runId: RUN, userId });
    await expect(consumeApprovalChallenge(db, { challenge: c, runId: RUN, userId })).resolves.toBe(true);
  });

  it("REFUSES a replay — the whole point of holding state", async () => {
    const { db, userId } = await seed();
    const c = await issueApprovalChallenge(db, { runId: RUN, userId });
    await consumeApprovalChallenge(db, { challenge: c, runId: RUN, userId });
    await expect(consumeApprovalChallenge(db, { challenge: c, runId: RUN, userId })).resolves.toBe(false);
  });

  it("REFUSES an expired challenge", async () => {
    const { db, userId } = await seed();
    const c = await issueApprovalChallenge(db, { runId: RUN, userId, ttlSeconds: 1 });
    const later = () => new Date(Date.now() + 5000);
    await expect(
      consumeApprovalChallenge(db, { challenge: c, runId: RUN, userId, now: later }),
    ).resolves.toBe(false);
  });

  it("REFUSES a challenge presented against a DIFFERENT run", async () => {
    const { db, userId } = await seed();
    await db.prepare("INSERT INTO runs (id, app_id, status) VALUES (?, ?, ?)")
      .bind("99999999-2222-4333-8444-555555555555", "app_1", "awaiting_approval").run();
    const c = await issueApprovalChallenge(db, { runId: RUN, userId });
    await expect(
      consumeApprovalChallenge(db, {
        challenge: c, runId: "99999999-2222-4333-8444-555555555555", userId,
      }),
    ).resolves.toBe(false);
  });

  it("REFUSES another user's challenge", async () => {
    const { db, userId } = await seed();
    const other = await upsertUser(db, "someone-else@example.com");
    const c = await issueApprovalChallenge(db, { runId: RUN, userId });
    await expect(
      consumeApprovalChallenge(db, { challenge: c, runId: RUN, userId: other.id }),
    ).resolves.toBe(false);
  });

  it("REFUSES an unknown value, and an empty one", async () => {
    const { db, userId } = await seed();
    await expect(consumeApprovalChallenge(db, { challenge: "nope", runId: RUN, userId })).resolves.toBe(false);
    await expect(consumeApprovalChallenge(db, { challenge: "", runId: RUN, userId })).resolves.toBe(false);
  });

  it("reuses a live challenge rather than piling up a row per render", async () => {
    const { db, userId } = await seed();
    const a = await issueApprovalChallenge(db, { runId: RUN, userId });
    const b = await issueApprovalChallenge(db, { runId: RUN, userId });
    expect(b).toBe(a);
    const { results } = await db
      .prepare("SELECT challenge FROM approval_challenges WHERE run_id = ?")
      .bind(RUN)
      .all<{ challenge: string }>();
    expect(results).toHaveLength(1);
  });

  it("issues a FRESH challenge once the previous one is spent", async () => {
    const { db, userId } = await seed();
    const a = await issueApprovalChallenge(db, { runId: RUN, userId });
    await consumeApprovalChallenge(db, { challenge: a, runId: RUN, userId });
    const b = await issueApprovalChallenge(db, { runId: RUN, userId });
    expect(b).not.toBe(a);
  });
});
