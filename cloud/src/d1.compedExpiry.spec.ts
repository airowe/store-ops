/**
 * Comped passes expire (Founders' Pass, Shipaton Pass). A `comped*` status with
 * a `current_period_end` in the past is demoted by the hourly cron — Stripe
 * source back to free, effective tier recomputed, so an IAP tier still wins.
 * Asserted against the REAL composed schema, like d1.revenuecatIap.spec.ts.
 */
import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expireCompedPasses, setTier, upsertUser } from "./d1.js";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null;
}

const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url).href);

function realSqlite(): import("node:sqlite").DatabaseSync {
  const sqlite = new DatabaseSync!(":memory:");
  sqlite.exec(readFileSync(SCHEMA_PATH, "utf8"));
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
  }
  return sqlite;
}

function d1(sqlite: import("node:sqlite").DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          return (sqlite.prepare(sql).get(...(bound as never[])) ?? null) as T | null;
        },
        async run() {
          const r = sqlite.prepare(sql).run(...(bound as never[]));
          return { success: true, meta: { changes: Number(r.changes) } } as never;
        },
        async all<T>() {
          return { results: sqlite.prepare(sql).all(...(bound as never[])) as T[] } as never;
        },
      };
      return stmt as never;
    },
  } as unknown as D1Database;
}

const row = (s: import("node:sqlite").DatabaseSync, id: string) =>
  s.prepare("SELECT tier, stripe_tier, iap_tier, status, current_period_end FROM users WHERE id = ?").get(id) as {
    tier: string; stripe_tier: string | null; iap_tier: string | null; status: string; current_period_end: string | null;
  };

const NOW = "2027-01-01T00:00:00.000Z";
const PAST = "2026-12-31T23:59:59.000Z";
const FUTURE = "2027-06-30T00:00:00.000Z";

describe.skipIf(DatabaseSync === null)("expireCompedPasses", () => {
  async function seed(sqlite: import("node:sqlite").DatabaseSync, email: string, args: Parameters<typeof setTier>[1] extends infer A ? Omit<A, "userId"> : never) {
    const db = d1(sqlite);
    const u = await upsertUser(db, email);
    await setTier(db, { userId: u.id, ...args });
    return u.id;
  }

  it("demotes a comped pass whose period ended, and leaves its expiry date as the record", async () => {
    const sqlite = realSqlite();
    const id = await seed(sqlite, "a@e.com", { tier: "startup", stripeTier: "startup", status: "comped:shipaton-2026", currentPeriodEnd: PAST });
    expect(await expireCompedPasses(d1(sqlite), NOW)).toBe(1);
    expect(row(sqlite, id)).toMatchObject({ tier: "free", stripe_tier: "free", status: "expired:comped:shipaton-2026", current_period_end: PAST });
  });

  it("ignores a comped pass still running, a paying subscriber past period end, and a free account", async () => {
    const sqlite = realSqlite();
    const live = await seed(sqlite, "b@e.com", { tier: "scale", stripeTier: "scale", status: "comped", currentPeriodEnd: FUTURE });
    const paying = await seed(sqlite, "c@e.com", { tier: "indie", stripeTier: "indie", status: "active", currentPeriodEnd: PAST });
    const free = await seed(sqlite, "d@e.com", {});
    expect(await expireCompedPasses(d1(sqlite), NOW)).toBe(0);
    expect(row(sqlite, live).tier).toBe("scale");
    expect(row(sqlite, paying).tier).toBe("indie");
    expect(row(sqlite, free).tier).toBe("free");
  });

  it("keeps an in-app tier that is still active when the comped web tier lapses", async () => {
    const sqlite = realSqlite();
    const id = await seed(sqlite, "e@e.com", { tier: "startup", stripeTier: "startup", iapTier: "indie", iapStatus: "active", status: "comped", currentPeriodEnd: PAST });
    expect(await expireCompedPasses(d1(sqlite), NOW)).toBe(1);
    expect(row(sqlite, id)).toMatchObject({ tier: "indie", stripe_tier: "free" });
  });

  it("is idempotent — a second sweep finds nothing", async () => {
    const sqlite = realSqlite();
    await seed(sqlite, "f@e.com", { tier: "startup", stripeTier: "startup", status: "comped", currentPeriodEnd: PAST });
    await expireCompedPasses(d1(sqlite), NOW);
    expect(await expireCompedPasses(d1(sqlite), NOW)).toBe(0);
  });
});
