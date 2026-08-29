/**
 * The three portfolio screens' backend (#356 Phase 1) — GET /runs, GET /keywords,
 * GET /competitors — through the real `handleApi` router, against an in-memory
 * SQLite built from the ACTUAL schema.sql. Using the real schema (rather than a
 * SQL-matching fake) means a query/schema divergence fails here rather than in
 * production, and it lets us COUNT the statements each route issues so an N+1
 * regression is caught by a test rather than by a slow dashboard.
 *
 * Honesty invariants pinned here:
 *   - a run with no findings summary yields `findings_summary: null` (the chip
 *     is absent, never a fabricated zero);
 *   - a keyword row is a keyword×app×storefront triple — never averaged across
 *     apps or markets;
 *   - `sharedTerms` is ABSENT from every competitor pair (see the route doc:
 *     we do not hold rival-vs-tracked-keyword rank data, so the count cannot be
 *     measured and is therefore not sent).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null; // Node < 22.5 — suite skips below.
}
const sqliteAvailable = DatabaseSync !== null;

const SCHEMA_PATH = fileURLToPath(new URL("../../schema.sql", import.meta.url).href);

type Harness = { db: D1Database; sql: string[] };

function d1From(schema: string): Harness {
  const sqlite = new DatabaseSync!(":memory:");
  sqlite.exec(schema);
  // rank_snapshots.country is added by migration 0002, not schema.sql (which is
  // the pre-0002 baseline). Apply it so the country column the keywords route
  // reads exists — same shape the deploy pipeline produces.
  sqlite.exec("ALTER TABLE rank_snapshots ADD COLUMN country TEXT NOT NULL DEFAULT ''");
  // approval_challenges arrives in migration 0016, after this baseline. GET
  // /runs issues a challenge per queued run (#515), so the table has to exist
  // or the route throws. Applied from the migration itself rather than a
  // hand-copied CREATE, so this cannot drift from what deploy produces.
  sqlite.exec(
    readFileSync(
      new URL("../../migrations/0016_approval_challenges.sql", import.meta.url),
      "utf8",
    ),
  );
  const sql: string[] = [];
  const db = {
    prepare(stmtSql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          sql.push(stmtSql);
          return (sqlite.prepare(stmtSql).get(...(bound as never[])) ?? null) as T | null;
        },
        async run() {
          sql.push(stmtSql);
          const info = sqlite.prepare(stmtSql).run(...(bound as never[]));
          return { success: true, meta: { changes: Number(info.changes) } } as never;
        },
        async all<T>() {
          sql.push(stmtSql);
          return { results: sqlite.prepare(stmtSql).all(...(bound as never[])) as T[] } as never;
        },
      };
      return stmt as never;
    },
    async batch(stmts: unknown[]) {
      return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  return { db: db as unknown as D1Database, sql };
}

function makeEnv(db: D1Database): Env {
  return { DB: db, DEFAULT_COUNTRY: "US", APP_ENV: "demo" } as Env;
}
function get(path: string, email: string | null = "owner@example.com"): Request {
  const headers: Record<string, string> = {};
  if (email) headers["x-user-email"] = email;
  return new Request(`https://api.test${path}`, { method: "GET", headers });
}

/** A reasoning trace with just the fields the portfolio routes read. */
function trace(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ ranks: [], ...over });
}

let h: Harness;
const exec = (sql: string) => (h.db as unknown as { prepare(s: string): { bind(): { run(): Promise<unknown> } } }).prepare(sql).bind().run();

beforeEach(async () => {
  if (!sqliteAvailable) return;
  h = d1From(readFileSync(SCHEMA_PATH, "utf8"));
  // Two users so every route is proven to scope to the CALLER's apps.
  await exec("INSERT INTO users (id, email) VALUES ('u1', 'owner@example.com')");
  await exec("INSERT INTO users (id, email) VALUES ('u2', 'other@example.com')");
  await exec("INSERT INTO apps (id, user_id, bundle_id, name, country) VALUES ('a1', 'u1', 'com.x.one', 'App One', 'US')");
  await exec("INSERT INTO apps (id, user_id, bundle_id, name, country) VALUES ('a2', 'u1', 'com.x.two', 'App Two', 'US')");
  await exec("INSERT INTO apps (id, user_id, bundle_id, name, country) VALUES ('b1', 'u2', 'com.y.one', 'Not Yours', 'US')");
});

// ── GET /runs ────────────────────────────────────────────────────────────────

describe.skipIf(!sqliteAvailable)("GET /runs", () => {
  it("returns every run across the user's apps, app-first", async () => {
    await exec(
      `INSERT INTO runs (id, app_id, status, created_at, reasoning_json)
       VALUES ('r1', 'a1', 'approved', '2026-07-01T00:00:00Z', '${trace()}')`,
    );
    await exec(
      `INSERT INTO runs (id, app_id, status, created_at, reasoning_json)
       VALUES ('r2', 'a2', 'shipped', '2026-07-02T00:00:00Z', '${trace()}')`,
    );

    const res = await handleApi(get("/runs"), makeEnv(h.db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: Array<Record<string, unknown>> };
    expect(body.runs).toHaveLength(2);
    // app_name is REQUIRED — every row on the screen is app-first.
    for (const r of body.runs) {
      expect(typeof r.app_name).toBe("string");
      expect(r.app_name).not.toBe("");
      expect(typeof r.app_id).toBe("string");
    }
    expect(body.runs.map((r) => r.app_name).sort()).toEqual(["App One", "App Two"]);
  });

  it("sorts awaiting_approval first at ANY age, then created_at desc", async () => {
    // The awaiting run is the OLDEST — it must still lead.
    await exec(
      `INSERT INTO runs (id, app_id, status, created_at, reasoning_json)
       VALUES ('old-awaiting', 'a1', 'awaiting_approval', '2026-01-01T00:00:00Z', '${trace()}')`,
    );
    await exec(
      `INSERT INTO runs (id, app_id, status, created_at, reasoning_json)
       VALUES ('newest', 'a2', 'approved', '2026-07-09T00:00:00Z', '${trace()}')`,
    );
    await exec(
      `INSERT INTO runs (id, app_id, status, created_at, reasoning_json)
       VALUES ('middle', 'a1', 'shipped', '2026-05-05T00:00:00Z', '${trace()}')`,
    );

    const res = await handleApi(get("/runs"), makeEnv(h.db));
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.map((r) => r.id)).toEqual(["old-awaiting", "newest", "middle"]);
  });

  it("carries findings_summary when the trace has one", async () => {
    await exec(
      `INSERT INTO runs (id, app_id, status, created_at, reasoning_json)
       VALUES ('r1', 'a1', 'approved', '2026-07-01T00:00:00Z',
               '${trace({ findingsSummary: { label: "B+", critical: 2 } })}')`,
    );
    const res = await handleApi(get("/runs"), makeEnv(h.db));
    const body = (await res.json()) as { runs: Array<{ findings_summary: unknown }> };
    expect(body.runs[0]!.findings_summary).toEqual({ label: "B+", critical: 2 });
  });

  it("HONESTY: a run with no findings yields null, never a zero chip", async () => {
    await exec(
      `INSERT INTO runs (id, app_id, status, created_at, reasoning_json)
       VALUES ('r1', 'a1', 'approved', '2026-07-01T00:00:00Z', '${trace()}')`,
    );
    const res = await handleApi(get("/runs"), makeEnv(h.db));
    const body = (await res.json()) as { runs: Array<{ findings_summary: unknown }> };
    expect(body.runs[0]!.findings_summary).toBeNull();
  });

  it("an unparseable trace degrades to null, not a 500", async () => {
    await exec(
      `INSERT INTO runs (id, app_id, status, created_at, reasoning_json)
       VALUES ('r1', 'a1', 'approved', '2026-07-01T00:00:00Z', 'not json{')`,
    );
    const res = await handleApi(get("/runs"), makeEnv(h.db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: Array<{ findings_summary: unknown }> };
    expect(body.runs[0]!.findings_summary).toBeNull();
  });

  it("carries 'superseded' — a status the wire union now admits", async () => {
    await exec(
      `INSERT INTO runs (id, app_id, status, created_at, reasoning_json)
       VALUES ('r1', 'a1', 'superseded', '2026-07-01T00:00:00Z', '${trace()}')`,
    );
    const res = await handleApi(get("/runs"), makeEnv(h.db));
    const body = (await res.json()) as { runs: Array<{ status: string }> };
    expect(body.runs[0]!.status).toBe("superseded");
  });

  it("NEVER leaks another user's runs", async () => {
    await exec(
      `INSERT INTO runs (id, app_id, status, created_at, reasoning_json)
       VALUES ('theirs', 'b1', 'awaiting_approval', '2026-07-01T00:00:00Z', '${trace()}')`,
    );
    const res = await handleApi(get("/runs"), makeEnv(h.db));
    const body = (await res.json()) as { runs: unknown[] };
    expect(body.runs).toEqual([]);
  });

  it("no runs → empty list, not an error", async () => {
    const res = await handleApi(get("/runs"), makeEnv(h.db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: [] });
  });

  it("401 without a user", async () => {
    expect((await handleApi(get("/runs", null), makeEnv(h.db))).status).toBe(401);
  });

  it("does NOT fan out per run (no N+1)", async () => {
    for (let i = 0; i < 12; i++) {
      await exec(
        `INSERT INTO runs (id, app_id, status, created_at, reasoning_json)
         VALUES ('r${i}', 'a1', 'approved', '2026-07-0${(i % 9) + 1}T00:00:00Z', '${trace()}')`,
      );
    }
    h.sql.length = 0;
    await handleApi(get("/runs"), makeEnv(h.db));
    const runReads = h.sql.filter((s) => /FROM runs/.test(s));
    expect(runReads).toHaveLength(1);
  });
});

// ── GET /keywords ────────────────────────────────────────────────────────────

describe.skipIf(!sqliteAvailable)("GET /keywords", () => {
  const snap = (id: string, app: string, kw: string, rank: number | null, at: string, country = "us") =>
    exec(
      `INSERT INTO rank_snapshots (id, app_id, keyword, rank, total, country, checked_at)
       VALUES ('${id}', '${app}', '${kw}', ${rank === null ? "NULL" : rank}, 200, '${country}', '${at}')`,
    );

  it("a row is a keyword×app×storefront triple, never averaged", async () => {
    // The SAME keyword tracked by two apps must produce TWO rows, each carrying
    // its own app and its own storefront — averaging would fabricate a rank.
    await snap("s1", "a1", "budget", 40, "2026-07-01T00:00:00Z", "us");
    await snap("s2", "a1", "budget", 12, "2026-07-08T00:00:00Z", "us");
    await snap("s3", "a2", "budget", 90, "2026-07-01T00:00:00Z", "jp");
    await snap("s4", "a2", "budget", 88, "2026-07-08T00:00:00Z", "jp");

    const res = await handleApi(get("/keywords"), makeEnv(h.db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ keyword: string; app_id: string; app_name: string; country: string; current: number | null }>;
    };
    const budget = body.entries.filter((e) => e.keyword === "budget");
    expect(budget).toHaveLength(2);
    expect(budget.map((e) => [e.app_id, e.country, e.current]).sort()).toEqual([
      ["a1", "us", 12],
      ["a2", "jp", 88],
    ]);
    for (const e of budget) expect(typeof e.app_name).toBe("string");
  });

  it("computes the delta + direction from the app's own history", async () => {
    await snap("s1", "a1", "budget", 40, "2026-07-01T00:00:00Z");
    await snap("s2", "a1", "budget", 12, "2026-07-08T00:00:00Z");
    const res = await handleApi(get("/keywords"), makeEnv(h.db));
    const body = (await res.json()) as {
      entries: Array<{ keyword: string; previous: number | null; current: number | null; direction: string }>;
    };
    const e = body.entries.find((x) => x.keyword === "budget")!;
    expect(e.previous).toBe(40);
    expect(e.current).toBe(12);
    expect(e.direction).toBe("up");
  });

  it("HONESTY: a single snapshot is 'new' with previous null — never a 0 baseline", async () => {
    await snap("s1", "a1", "solo", 30, "2026-07-08T00:00:00Z");
    const res = await handleApi(get("/keywords"), makeEnv(h.db));
    const body = (await res.json()) as {
      entries: Array<{ keyword: string; previous: number | null; direction: string }>;
    };
    const e = body.entries.find((x) => x.keyword === "solo")!;
    expect(e.previous).toBeNull();
    expect(e.direction).toBe("new");
  });

  it("HONESTY: an unranked read is null rank, never 0", async () => {
    await snap("s1", "a1", "longshot", null, "2026-07-01T00:00:00Z");
    await snap("s2", "a1", "longshot", null, "2026-07-08T00:00:00Z");
    const res = await handleApi(get("/keywords"), makeEnv(h.db));
    const body = (await res.json()) as { entries: Array<{ keyword: string; current: number | null }> };
    const e = body.entries.find((x) => x.keyword === "longshot")!;
    expect(e.current).toBeNull();
    expect(e.current).not.toBe(0);
  });

  it("keeps storefronts separate for the SAME app + keyword", async () => {
    await snap("s1", "a1", "planner", 10, "2026-07-08T00:00:00Z", "us");
    await snap("s2", "a1", "planner", 3, "2026-07-08T00:00:00Z", "jp");
    const res = await handleApi(get("/keywords"), makeEnv(h.db));
    const body = (await res.json()) as {
      entries: Array<{ keyword: string; country: string; current: number | null }>;
    };
    const rows = body.entries.filter((e) => e.keyword === "planner");
    expect(rows.map((r) => [r.country, r.current]).sort()).toEqual([
      ["jp", 3],
      ["us", 10],
    ]);
  });

  it("NEVER leaks another user's keywords", async () => {
    await snap("s1", "b1", "theirs", 5, "2026-07-08T00:00:00Z");
    const res = await handleApi(get("/keywords"), makeEnv(h.db));
    const body = (await res.json()) as { entries: Array<{ keyword: string }> };
    expect(body.entries.map((e) => e.keyword)).not.toContain("theirs");
  });

  it("no snapshots → empty list", async () => {
    const res = await handleApi(get("/keywords"), makeEnv(h.db));
    expect(await res.json()).toEqual({ entries: [] });
  });

  it("401 without a user", async () => {
    expect((await handleApi(get("/keywords", null), makeEnv(h.db))).status).toBe(401);
  });

  it("does NOT fan out per app (no N+1)", async () => {
    await snap("s1", "a1", "budget", 40, "2026-07-01T00:00:00Z");
    await snap("s2", "a2", "budget", 90, "2026-07-01T00:00:00Z");
    h.sql.length = 0;
    await handleApi(get("/keywords"), makeEnv(h.db));
    const rankReads = h.sql.filter((s) => /FROM rank_snapshots/.test(s));
    expect(rankReads).toHaveLength(1);
  });
});

// ── GET /competitors ─────────────────────────────────────────────────────────

describe.skipIf(!sqliteAvailable)("GET /competitors", () => {
  const comp = (app: string, key: string, name: string, status: string, source = "user") =>
    exec(
      `INSERT INTO app_competitors (app_id, comp_key, name, source, status)
       VALUES ('${app}', '${key}', '${name}', '${source}', '${status}')`,
    );

  it("groups by RIVAL, with one pair per app that watches it", async () => {
    await comp("a1", "111", "Rival A", "confirmed");
    await comp("a2", "111", "Rival A", "suggested", "discovered");
    await comp("a1", "222", "Rival B", "confirmed");

    const res = await handleApi(get("/competitors"), makeEnv(h.db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rivals: Array<{ key: string; name: string; pairs: Array<{ app_id: string; app_name: string; status: string; source: string }> }>;
    };
    const a = body.rivals.find((r) => r.key === "111")!;
    expect(a.name).toBe("Rival A");
    expect(a.pairs).toHaveLength(2);
    expect(a.pairs.map((p) => [p.app_id, p.app_name, p.status]).sort()).toEqual([
      ["a1", "App One", "confirmed"],
      ["a2", "App Two", "suggested"],
    ]);
    const b = body.rivals.find((r) => r.key === "222")!;
    expect(b.pairs).toHaveLength(1);
  });

  it("watching stays PER-PAIR: confirmed for one app, suggested for another", async () => {
    await comp("a1", "111", "Rival A", "confirmed");
    await comp("a2", "111", "Rival A", "suggested", "discovered");
    const res = await handleApi(get("/competitors"), makeEnv(h.db));
    const body = (await res.json()) as {
      rivals: Array<{ pairs: Array<{ app_id: string; status: string; source: string }> }>;
    };
    const pairs = body.rivals[0]!.pairs;
    expect(pairs.find((p) => p.app_id === "a1")!.status).toBe("confirmed");
    expect(pairs.find((p) => p.app_id === "a2")!.status).toBe("suggested");
    expect(pairs.find((p) => p.app_id === "a2")!.source).toBe("discovered");
  });

  it("HONESTY: sharedTerms is ABSENT — we cannot measure it, so we do not send it", async () => {
    await comp("a1", "111", "Rival A", "confirmed");
    const res = await handleApi(get("/competitors"), makeEnv(h.db));
    const body = (await res.json()) as { rivals: Array<{ pairs: Array<Record<string, unknown>> }> };
    const pair = body.rivals[0]!.pairs[0]!;
    expect("sharedTerms" in pair).toBe(false);
    // and emphatically not a fabricated zero
    expect(pair.sharedTerms).toBeUndefined();
  });

  it("NEVER leaks another user's rivals", async () => {
    await comp("b1", "999", "Their Rival", "confirmed");
    const res = await handleApi(get("/competitors"), makeEnv(h.db));
    const body = (await res.json()) as { rivals: Array<{ key: string }> };
    expect(body.rivals.map((r) => r.key)).not.toContain("999");
  });

  it("no competitors → empty list", async () => {
    const res = await handleApi(get("/competitors"), makeEnv(h.db));
    expect(await res.json()).toEqual({ rivals: [] });
  });

  it("DEPLOY ORDER: a DB without app_competitors degrades to [] (no crash)", async () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8")
      .replace(/CREATE TABLE IF NOT EXISTS app_competitors[\s\S]*?\n\);/, "")
      .replace(/CREATE INDEX IF NOT EXISTS idx_app_competitors[^;]*;/, "");
    const bare = d1From(schema);
    await (bare.db as unknown as { prepare(s: string): { bind(): { run(): Promise<unknown> } } })
      .prepare("INSERT INTO users (id, email) VALUES ('u1', 'owner@example.com')").bind().run();
    const res = await handleApi(get("/competitors"), makeEnv(bare.db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rivals: [] });
  });

  it("401 without a user", async () => {
    expect((await handleApi(get("/competitors", null), makeEnv(h.db))).status).toBe(401);
  });

  it("does NOT fan out per app (no N+1)", async () => {
    await comp("a1", "111", "Rival A", "confirmed");
    await comp("a2", "111", "Rival A", "confirmed");
    h.sql.length = 0;
    await handleApi(get("/competitors"), makeEnv(h.db));
    const compReads = h.sql.filter((s) => /FROM app_competitors/.test(s));
    expect(compReads).toHaveLength(1);
  });
});
