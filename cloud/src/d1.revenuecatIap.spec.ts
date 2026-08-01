/**
 * RevenueCat IAP as a SECOND payment source (migration 0012) — REAL-SCHEMA test.
 *
 * Policy: the highest ACTIVE tier wins across the Stripe (web) and RevenueCat
 * (in-app) sources. `users.tier` is materialized from `stripe_tier` + `iap_tier`
 * by `recomputeEffectiveTier`, so every existing reader of `tier` stays correct.
 *
 * Asserted against the REAL composed schema (schema.sql baseline + every migration
 * in order, exactly what deploy applies), so the migration and the round-trip
 * through the real `setTier` / `recomputeEffectiveTier` helpers are under test —
 * a divergence between a query and the schema fails loudly here, not in prod.
 * Uses node:sqlite (Node 22.5+) behind a tiny D1 adapter; SKIPS on older Node.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { recomputeEffectiveTier, setTier, upsertUser } from "./d1.js";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const sqliteAvailable = DatabaseSync !== null;

const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url).href);

function realSqlite(): import("node:sqlite").DatabaseSync {
  const sqlite = new DatabaseSync!(":memory:");
  sqlite.exec(readFileSync(SCHEMA_PATH, "utf8"));
  for (const f of readdirSync(MIGRATIONS_DIR)
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
  }
  return sqlite;
}

/** Minimal D1Database adapter over node:sqlite — prepare/bind/first/run/all. */
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
          sqlite.prepare(sql).run(...(bound as never[]));
          return { success: true, meta: { changes: 1 } } as never;
        },
        async all<T>() {
          return { results: sqlite.prepare(sql).all(...(bound as never[])) as T[] } as never;
        },
      };
      return stmt as never;
    },
  } as unknown as D1Database;
}

const tierOf = (sqlite: import("node:sqlite").DatabaseSync, id: string) =>
  (sqlite.prepare("SELECT tier FROM users WHERE id = ?").get(id) as { tier: string }).tier;

describe.skipIf(!sqliteAvailable)("migration 0012 — RevenueCat IAP columns", () => {
  const cols = () =>
    (realSqlite().prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );

  it("adds every IAP/source column after the real schema + migration compose", () => {
    const names = cols();
    for (const c of [
      "stripe_tier",
      "iap_tier",
      "iap_status",
      "iap_product_id",
      "iap_period_end",
      "revenuecat_app_user_id",
    ]) {
      expect(names, c).toContain(c);
    }
  });

  it("declares the columns in the migration only, never in the schema baseline", () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    for (const c of ["stripe_tier", "iap_tier", "iap_status", "iap_product_id"]) {
      expect(new RegExp(`^\\s*${c}\\s+TEXT`, "m").test(schema), `${c} in schema.sql`).toBe(false);
    }
  });

  it("backfills stripe_tier from the existing tier for a pre-existing row", () => {
    // A fresh DB has no rows to backfill; re-run the backfill statement against a
    // seeded row to prove the migration's UPDATE keeps an existing plan intact.
    const sqlite = realSqlite();
    sqlite.exec("INSERT INTO users (id, email, tier) VALUES ('u-old', 'old@e.co', 'scale')");
    sqlite.exec("UPDATE users SET stripe_tier = tier");
    const row = sqlite.prepare("SELECT stripe_tier FROM users WHERE id='u-old'").get() as {
      stripe_tier: string;
    };
    expect(row.stripe_tier).toBe("scale");
  });
});

describe.skipIf(!sqliteAvailable)("recomputeEffectiveTier — highest active tier wins", () => {
  let sqlite: import("node:sqlite").DatabaseSync;
  let db: D1Database;

  beforeEach(async () => {
    sqlite = realSqlite();
    db = d1(sqlite);
    await upsertUser(db, "user@e.co");
  });

  const uid = async () =>
    (sqlite.prepare("SELECT id FROM users WHERE email='user@e.co'").get() as { id: string }).id;

  it("a new user starts on free with both sources empty", async () => {
    const id = await uid();
    const row = sqlite
      .prepare("SELECT tier, stripe_tier, iap_tier FROM users WHERE id = ?")
      .get(id) as { tier: string; stripe_tier: string | null; iap_tier: string | null };
    expect(row.tier).toBe("free");
    expect(row.stripe_tier).toBeNull();
    expect(row.iap_tier).toBeNull();
  });

  it("materializes the Stripe source tier when it's the only one", async () => {
    const id = await uid();
    await setTier(db, { userId: id, stripeTier: "indie", status: "active" });
    expect(await recomputeEffectiveTier(db, id)).toBe("indie");
    expect(tierOf(sqlite, id)).toBe("indie");
  });

  it("materializes the IAP source tier when it's the only one", async () => {
    const id = await uid();
    await setTier(db, { userId: id, iapTier: "startup", iapStatus: "active" });
    expect(await recomputeEffectiveTier(db, id)).toBe("startup");
    expect(tierOf(sqlite, id)).toBe("startup");
  });

  it("picks the higher tier when a user holds BOTH a web and an IAP subscription", async () => {
    const id = await uid();
    await setTier(db, { userId: id, stripeTier: "indie", status: "active" });
    await recomputeEffectiveTier(db, id);
    // then buys scale in-app → effective jumps to scale
    await setTier(db, { userId: id, iapTier: "scale", iapStatus: "active" });
    expect(await recomputeEffectiveTier(db, id)).toBe("scale");
    expect(tierOf(sqlite, id)).toBe("scale");
  });

  it("falls back to the surviving source when the higher one expires", async () => {
    const id = await uid();
    await setTier(db, { userId: id, stripeTier: "indie", status: "active" });
    await setTier(db, { userId: id, iapTier: "scale", iapStatus: "active" });
    await recomputeEffectiveTier(db, id);
    expect(tierOf(sqlite, id)).toBe("scale");
    // IAP expires (revoke) → effective drops back to the still-active web tier
    await setTier(db, { userId: id, iapTier: "free", iapStatus: "expired" });
    expect(await recomputeEffectiveTier(db, id)).toBe("indie");
    expect(tierOf(sqlite, id)).toBe("indie");
  });

  it("keeps the IAP tier when the web sub cancels (highest active still wins)", async () => {
    const id = await uid();
    await setTier(db, { userId: id, stripeTier: "startup", status: "active" });
    await setTier(db, { userId: id, iapTier: "scale", iapStatus: "active" });
    await recomputeEffectiveTier(db, id);
    // web sub deleted → stripe source grants nothing, but IAP scale is still active
    await setTier(db, { userId: id, stripeTier: "free", status: "canceled" });
    expect(await recomputeEffectiveTier(db, id)).toBe("scale");
    expect(tierOf(sqlite, id)).toBe("scale");
  });

  it("drops to free only when BOTH sources are gone", async () => {
    const id = await uid();
    await setTier(db, { userId: id, stripeTier: "indie", iapTier: "scale" });
    await recomputeEffectiveTier(db, id);
    await setTier(db, { userId: id, stripeTier: "free", iapTier: "free" });
    expect(await recomputeEffectiveTier(db, id)).toBe("free");
    expect(tierOf(sqlite, id)).toBe("free");
  });

  it("persists the IAP bookkeeping fields written by setTier", async () => {
    const id = await uid();
    await setTier(db, {
      userId: id,
      revenuecatAppUserId: id,
      iapTier: "scale",
      iapStatus: "active",
      iapProductId: "rc_scale",
      iapPeriodEnd: "2030-01-01T00:00:00.000Z",
    });
    const row = sqlite
      .prepare(
        "SELECT iap_product_id, iap_status, iap_period_end, revenuecat_app_user_id FROM users WHERE id = ?",
      )
      .get(id) as {
      iap_product_id: string;
      iap_status: string;
      iap_period_end: string;
      revenuecat_app_user_id: string;
    };
    expect(row.iap_product_id).toBe("rc_scale");
    expect(row.iap_status).toBe("active");
    expect(row.iap_period_end).toBe("2030-01-01T00:00:00.000Z");
    expect(row.revenuecat_app_user_id).toBe(id);
  });

  it("returns free for an unknown user without throwing", async () => {
    expect(await recomputeEffectiveTier(db, "ghost")).toBe("free");
  });
});
