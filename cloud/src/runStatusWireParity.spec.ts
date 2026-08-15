/**
 * The WIRE RunStatus union (`packages/api/types.ts`) must admit exactly the
 * statuses a real row can carry. Three sources have to agree:
 *
 *   schema.sql's CHECK constraint  (what the DB will ACCEPT)
 *   engine/constants RUN_STATUSES  (what the server WRITES)
 *   packages/api RunStatus         (what the client is told it can READ)
 *
 * They diverged: `superseded` is CHECK-allowed and actively written by
 * `insertRun` (d1.ts — it supersedes the app's previous awaiting_approval run),
 * listed in RUN_STATUSES, and labelled by the web status map — but the wire
 * union omitted it, so every superseded row on the wire carried a status the
 * type said was impossible.
 *
 * This header used to credit `setRunStatus` for that write. It never performed
 * it, and the function itself was dead; both are gone (runStatusWriters.spec.ts).
 *
 * The union is erased at runtime, so it is read out of the source text. That
 * is deliberate: the point is to catch the source of truth drifting, and a
 * `satisfies` check in TS would only fail the typecheck gate, not this suite.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RUN_STATUSES } from "./engine/constants.js";

const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);
const WIRE_TYPES_PATH = fileURLToPath(
  new URL("../../packages/api/types.ts", import.meta.url).href,
);

/** The statuses schema.sql's runs CHECK constraint actually admits. */
function schemaCheckStatuses(): string[] {
  const sql = readFileSync(SCHEMA_PATH, "utf8");
  const table = /CREATE TABLE IF NOT EXISTS runs\b[\s\S]*?\n\);/.exec(sql)?.[0] ?? "";
  const check = /CHECK\s*\(\s*status\s+IN\s*\(([\s\S]*?)\)\s*\)/.exec(table)?.[1] ?? "";
  return [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

/** The members of the exported `RunStatus` union in packages/api/types.ts. */
function wireUnionMembers(): string[] {
  const src = readFileSync(WIRE_TYPES_PATH, "utf8");
  const decl = /export type RunStatus\s*=([\s\S]*?);/.exec(src)?.[1] ?? "";
  return [...decl.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
}

describe("RunStatus wire parity", () => {
  it("schema.sql's runs CHECK and RUN_STATUSES agree", () => {
    expect(schemaCheckStatuses().sort()).toEqual([...RUN_STATUSES].sort());
  });

  it("the wire union admits every status the DB can hold", () => {
    expect(wireUnionMembers().sort()).toEqual(schemaCheckStatuses().sort());
  });

  it("includes 'superseded' — insertRun writes it, so a client can read it", () => {
    expect(wireUnionMembers()).toContain("superseded");
  });
});
