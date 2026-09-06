/**
 * Who is allowed to write `runs.status`, and does every writer still exist?
 *
 * `setRunStatus` (d1.ts) was an exported, live-looking status writer with ZERO
 * callers. It was left behind by #43 (`ddf6b67`, 2026-06-19), which made
 * approval set 'approved' instead of the dishonest 'shipped'. The dead function
 * outlived the transition it belonged to, and `runStatusWireParity.spec.ts`
 * still cited it as the reason 'superseded' had to be on the wire — crediting a
 * function that never wrote it (the real writer is insertRun's inline SQL).
 *
 * That is the failure mode this guards: not "unused code exists", but a stale
 * writer that makes a reader believe a transition happens which does not. The
 * production data says it plainly — every 'shipped' row predates #43, and no
 * row has been written with that status since.
 *
 * So this pins the writer set itself. Adding a status write means adding it
 * here, deliberately.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const D1_PATH = fileURLToPath(new URL("./d1.ts", import.meta.url).href);
const d1 = readFileSync(D1_PATH, "utf8");

/**
 * Every `UPDATE runs SET status` in d1.ts, with the status it writes when the
 * SQL names a literal ('?' means it is bound by the caller).
 */
function statusWrites(): { sql: string; literal: string | null }[] {
  return [...d1.matchAll(/"UPDATE runs SET status\s*=\s*([^"]*)"/g)].map((m) => {
    const tail = m[1] ?? "";
    const lit = /^\s*'([a-z_]+)'/.exec(tail);
    return { sql: m[0], literal: lit?.[1] ?? null };
  });
}

describe("runs.status writers", () => {
  /**
   * Exactly two, and each is reached from a real code path:
   *   recordApproval — 'approved' | 'rejected', bound by the decision
   *   insertRun      — 'superseded', for the run this one replaces
   */
  it("d1.ts writes runs.status in exactly three places", () => {
    expect(statusWrites()).toHaveLength(3);
  });

  it("the only literal statuses written are 'superseded' and 'shipped'", () => {
    expect(statusWrites().flatMap((w) => (w.literal ? [w.literal] : [])).sort()).toEqual(["shipped", "superseded"]);
  });

  /**
   * The regression that motivated this file. `setRunStatus` was exported, took
   * an arbitrary RunStatus, and nothing called it — so d1.ts read as though
   * some caller could still move a run to 'shipped'. Nothing can.
   */
  it("exports no general-purpose status setter with no caller", () => {
    expect(d1).not.toMatch(/export async function setRunStatus\b/);
  });

  /**
   * 'shipped' was legacy-only from #43 (2026-06-19) until autopilot (migration
   * 0017). It is now written in exactly ONE place — markRunShipped — and only
   * from 'approved', after the metadata write returned success from Apple. A
   * person approving never sets it, and approval is still the terminus of the
   * human's involvement: the agent executes what was approved, nothing more.
   */
  it("'shipped' is written only by markRunShipped, guarded on 'approved'", () => {
    const writes = [...d1.matchAll(/UPDATE runs SET status\s*=\s*'shipped'[^"]*/g)].map((m) => m[0]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/AND status = 'approved'/);
    expect(d1).not.toMatch(/\?\s*"shipped"\s*:/);
    expect(d1).toMatch(/export async function markRunShipped\b/);
  });
});
