/**
 * The drawer's derivations.
 *
 * Each of these is a claim a screenshot cannot falsify: a tool that pulses
 * forever, a duration measured against the wrong event, a "2 calls" badge that
 * counts starts as completions. They are pure over the activity log precisely
 * so they can be tested exhaustively here.
 *
 * The measured-or-nothing rule reaches durations too: a call whose `start` has
 * aged out of the capped log has NO duration, and must render as absent rather
 * than as 0ms.
 */
import { describe, expect, it } from "vitest";
import { durationMs, formatDuration, runningNames, summarize } from "./panelState.js";
import type { ActivityEntry } from "./useWebMcp.js";

/** Build a newest-first log the way `useWebMcp` does. */
function log(...entries: Array<Partial<ActivityEntry> & { name: string; phase: ActivityEntry["phase"] }>): ActivityEntry[] {
  return entries.map((e, i) => ({
    at: e.at ?? 1000,
    seq: e.seq ?? entries.length - i,
    message: e.message,
    name: e.name,
    phase: e.phase,
  }));
}

describe("runningNames", () => {
  it("is empty for an empty log", () => {
    expect(runningNames([]).size).toBe(0);
  });

  it("marks a tool whose latest event is a start", () => {
    expect([...runningNames(log({ name: "whoami", phase: "start" }))]).toEqual(["whoami"]);
  });

  it("CLEARS a tool once it finishes — otherwise it pulses forever", () => {
    // Newest first: the `done` is the latest event for this name.
    const l = log({ name: "whoami", phase: "done", seq: 2 }, { name: "whoami", phase: "start", seq: 1 });
    expect(runningNames(l).size).toBe(0);
  });

  it("clears on error too, not only on success", () => {
    const l = log({ name: "whoami", phase: "error", seq: 2 }, { name: "whoami", phase: "start", seq: 1 });
    expect(runningNames(l).size).toBe(0);
  });

  it("tracks several tools independently", () => {
    const l = log(
      { name: "explain_run", phase: "start", seq: 3 },
      { name: "whoami", phase: "done", seq: 2 },
      { name: "whoami", phase: "start", seq: 1 },
    );
    expect([...runningNames(l)]).toEqual(["explain_run"]);
  });

  it("treats a RE-RUN of a finished tool as running again", () => {
    const l = log(
      { name: "whoami", phase: "start", seq: 3 },
      { name: "whoami", phase: "done", seq: 2 },
      { name: "whoami", phase: "start", seq: 1 },
    );
    expect([...runningNames(l)]).toEqual(["whoami"]);
  });
});

describe("durationMs", () => {
  it("measures a completed call against its own start", () => {
    const l = log(
      { name: "whoami", phase: "done", seq: 2, at: 1500 },
      { name: "whoami", phase: "start", seq: 1, at: 1000 },
    );
    expect(durationMs(l, l[0]!)).toBe(500);
  });

  it("is null for a call still running — it has not taken a duration YET", () => {
    const l = log({ name: "whoami", phase: "start", seq: 1, at: 1000 });
    expect(durationMs(l, l[0]!)).toBeNull();
  });

  it("is null when the start has aged out of the capped log", () => {
    // NOT 0: an unmeasurable duration is absent, the same rule that forbids
    // showing 0 for an unknown rank.
    const l = log({ name: "whoami", phase: "done", seq: 9, at: 1500 });
    expect(durationMs(l, l[0]!)).toBeNull();
  });

  it("matches the start belonging to the SAME tool, not whichever came first", () => {
    const l = log(
      { name: "whoami", phase: "done", seq: 4, at: 2000 },
      { name: "explain_run", phase: "start", seq: 3, at: 1800 },
      { name: "whoami", phase: "start", seq: 2, at: 1000 },
    );
    expect(durationMs(l, l[0]!)).toBe(1000);
  });

  it("pairs a re-run with its OWN start, not the earlier one", () => {
    const l = log(
      { name: "whoami", phase: "done", seq: 4, at: 3000 },
      { name: "whoami", phase: "start", seq: 3, at: 2900 },
      { name: "whoami", phase: "done", seq: 2, at: 1500 },
      { name: "whoami", phase: "start", seq: 1, at: 1000 },
    );
    expect(durationMs(l, l[0]!)).toBe(100);
  });

  it("is null rather than negative if timestamps disagree", () => {
    const l = log(
      { name: "whoami", phase: "done", seq: 2, at: 500 },
      { name: "whoami", phase: "start", seq: 1, at: 1000 },
    );
    expect(durationMs(l, l[0]!)).toBeNull();
  });
});

describe("summarize", () => {
  it("reports an empty log as idle with nothing latest", () => {
    expect(summarize([])).toEqual({
      runningCount: 0, latestName: null, completed: 0, failed: 0,
    });
  });

  it("counts completions and failures separately", () => {
    const l = log(
      { name: "a", phase: "error", seq: 4 },
      { name: "b", phase: "done", seq: 3 },
      { name: "a", phase: "start", seq: 2 },
      { name: "b", phase: "start", seq: 1 },
    );
    const s = summarize(l);
    expect(s.completed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.runningCount).toBe(0);
  });

  it("does NOT count a start as a completed call", () => {
    const s = summarize(log({ name: "a", phase: "start", seq: 1 }));
    expect(s.completed).toBe(0);
    expect(s.runningCount).toBe(1);
  });

  it("names the most recent tool, running or not", () => {
    expect(summarize(log({ name: "explain_run", phase: "start", seq: 2 })).latestName)
      .toBe("explain_run");
  });
});

describe("formatDuration", () => {
  it("renders nothing for an unmeasured duration", () => {
    expect(formatDuration(null)).toBe("");
  });

  it("uses ms below a second and seconds above", () => {
    expect(formatDuration(144)).toBe("144ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(2804)).toBe("2.8s");
  });

  it("renders a real zero as 0ms — measured-zero is not the same as absent", () => {
    expect(formatDuration(0)).toBe("0ms");
  });
});
