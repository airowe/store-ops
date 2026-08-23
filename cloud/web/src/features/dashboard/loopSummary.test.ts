/**
 * Aggregating LoopState across a portfolio.
 *
 * The rules here are all honesty rules, and each has a way of being violated
 * that looks reasonable in code review:
 *   - a fleet where nothing has been swept must not report a last-sweep,
 *   - an app with no computable next slot must not borrow another app's,
 *   - zero agent runs must read as "not yet", never as a suspicious "0 checks".
 */
import { describe, expect, it } from "vitest";
import type { AppListItem } from "@shipaso/api";
import { loopSummary } from "./loopSummary.js";

const app = (loop: AppListItem["loop"]): AppListItem =>
  ({
    id: "a",
    name: "App",
    bundle_id: "com.x",
    latest_run: null,
    rank_summary: null,
    findings_summary: null,
    loop,
  }) as AppListItem;

const L = (o: Partial<NonNullable<AppListItem["loop"]>>) => ({
  last_sweep_at: null,
  next_sweep_at: null,
  agent_run_count: 0,
  agent_since: null,
  ...o,
});

describe("loopSummary", () => {
  it("takes the MOST RECENT sweep across apps", () => {
    const s = loopSummary([
      app(L({ last_sweep_at: "2026-08-10T09:00:00Z" })),
      app(L({ last_sweep_at: "2026-08-17T09:00:00Z" })),
      app(L({ last_sweep_at: "2026-08-03T09:00:00Z" })),
    ]);
    expect(s.lastSweepAt).toBe("2026-08-17T09:00:00Z");
  });

  it("takes the SOONEST next check across apps", () => {
    const s = loopSummary([
      app(L({ next_sweep_at: "2026-08-31T09:00:00Z" })),
      app(L({ next_sweep_at: "2026-08-24T09:00:00Z" })),
    ]);
    expect(s.nextSweepAt).toBe("2026-08-24T09:00:00Z");
  });

  it("sums agent runs across the portfolio", () => {
    const s = loopSummary([
      app(L({ agent_run_count: 9 })),
      app(L({ agent_run_count: 7 })),
      app(L({ agent_run_count: 3 })),
    ]);
    expect(s.agentRunCount).toBe(19);
  });

  it("takes the EARLIEST watching-since — when the fleet came under watch", () => {
    const s = loopSummary([
      app(L({ agent_since: "2026-07-06T09:00:00Z" })),
      app(L({ agent_since: "2026-06-21T09:00:00Z" })),
    ]);
    expect(s.agentSince).toBe("2026-06-21T09:00:00Z");
  });

  it("a fleet that has never been swept reports null, not the epoch", () => {
    const s = loopSummary([app(L({})), app(L({}))]);
    expect(s.lastSweepAt).toBeNull();
    expect(s.agentSince).toBeNull();
    expect(s.agentRunCount).toBe(0);
  });

  it("ignores apps with NO loop field at all (a pre-deploy Worker response)", () => {
    const s = loopSummary([
      app(L({ last_sweep_at: "2026-08-17T09:00:00Z", agent_run_count: 9 })),
      { id: "b", name: "B", bundle_id: "com.y", latest_run: null, rank_summary: null, findings_summary: null } as AppListItem,
    ]);
    expect(s.lastSweepAt).toBe("2026-08-17T09:00:00Z");
    expect(s.agentRunCount).toBe(9);
  });

  it("an empty portfolio is all-null, never a fabricated schedule", () => {
    const s = loopSummary([]);
    expect(s.lastSweepAt).toBeNull();
    expect(s.nextSweepAt).toBeNull();
    expect(s.agentSince).toBeNull();
    expect(s.agentRunCount).toBe(0);
  });

  it("a null next_sweep_at on one app does not suppress another's", () => {
    const s = loopSummary([
      app(L({ next_sweep_at: null })),
      app(L({ next_sweep_at: "2026-08-24T09:00:00Z" })),
    ]);
    expect(s.nextSweepAt).toBe("2026-08-24T09:00:00Z");
  });
});
