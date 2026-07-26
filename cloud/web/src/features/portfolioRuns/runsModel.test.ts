import { describe, it, expect } from "vitest";
import type { PortfolioRunRow, RunStatus } from "@shipaso/api";
import {
  applyFilter,
  dayLabel,
  groupByDay,
  initialFor,
  partition,
  pluralRuns,
  queueHeadline,
} from "./runsModel.js";

const NOW = Date.parse("2026-07-25T12:00:00Z");

function row(id: string, status: RunStatus, created_at: string): PortfolioRunRow {
  return { id, status, created_at, app_id: `app-${id}`, app_name: `App ${id}`, findings_summary: null };
}

describe("partition", () => {
  it("splits by status alone and preserves the server's order in both halves", () => {
    // Deliberately server-ordered: awaiting_approval first at ANY age (the
    // oldest run leads), then created_at desc. A client re-sort would reorder
    // both halves, so both are asserted.
    const runs = [
      row("q1", "awaiting_approval", "2026-01-01T00:00:00Z"),
      row("q2", "awaiting_approval", "2026-07-25T09:00:00Z"),
      row("h1", "approved", "2026-07-25T08:00:00Z"),
      row("h2", "rejected", "2026-07-24T08:00:00Z"),
      row("h3", "superseded", "2026-07-20T08:00:00Z"),
    ];
    const { queue, history } = partition(runs);
    expect(queue.map((r) => r.id)).toEqual(["q1", "q2"]);
    expect(history.map((r) => r.id)).toEqual(["h1", "h2", "h3"]);
  });

  it("puts every non-awaiting status in history", () => {
    const statuses: RunStatus[] = ["detected", "researching", "approved", "rejected", "shipped", "superseded"];
    const runs = statuses.map((s, i) => row(String(i), s, "2026-07-25T00:00:00Z"));
    expect(partition(runs).queue).toEqual([]);
    expect(partition(runs).history).toHaveLength(statuses.length);
  });
});

describe("applyFilter", () => {
  const runs: PortfolioRunRow[] = [
    row("a", "approved", "2026-07-25T00:00:00Z"),
    row("s", "shipped", "2026-07-25T00:00:00Z"),
    row("d", "detected", "2026-07-25T00:00:00Z"),
    row("r", "researching", "2026-07-25T00:00:00Z"),
    row("x", "rejected", "2026-07-25T00:00:00Z"),
    row("z", "superseded", "2026-07-25T00:00:00Z"),
  ];

  it.each([
    ["all", ["a", "s", "d", "r", "x", "z"]],
    ["approved", ["a", "s"]],
    ["in-progress", ["d", "r"]],
    ["rejected", ["x"]],
    ["superseded", ["z"]],
  ] as const)("%s keeps the right rows in order", (filter, expected) => {
    expect(applyFilter(runs, filter).map((r) => r.id)).toEqual(expected);
  });
});

describe("dayLabel", () => {
  it.each([
    ["2026-07-25T10:00:00Z", "Today"],
    ["2026-07-24T10:00:00Z", "Yesterday"],
  ])("%s reads as %s", (iso, prefix) => {
    expect(dayLabel(iso, NOW)).toContain(prefix);
  });

  it("older days name the weekday", () => {
    // 2026-07-22 is a Wednesday.
    expect(dayLabel("2026-07-22T10:00:00Z", NOW)).toBe("Wednesday · Jul 22");
  });
});

describe("groupByDay", () => {
  it("groups in arrival order without re-sorting", () => {
    const rows = [
      row("a", "approved", "2026-07-25T10:00:00Z"),
      row("b", "approved", "2026-07-25T08:00:00Z"),
      row("c", "rejected", "2026-07-24T08:00:00Z"),
      row("d", "approved", "2026-07-25T12:00:00Z"),
    ];
    const groups = groupByDay(rows, NOW);
    // "d" is the same day as a/b but arrives after c, so it opens a THIRD
    // group rather than being hoisted — hoisting would be a re-sort.
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([["a", "b"], ["c"], ["d"]]);
  });
});

describe("copy helpers", () => {
  it.each([
    [1, "1 run"],
    [3, "3 runs"],
    [0, "0 runs"],
  ])("pluralRuns(%i) is %s", (n, expected) => {
    expect(pluralRuns(n)).toBe(expected);
  });

  it("derives the queue headline from the real count", () => {
    expect(queueHeadline(1)).toBe("One run is ready for your decision.");
    expect(queueHeadline(4)).toBe("4 runs are ready for your decision.");
  });

  it("takes an uppercase initial", () => {
    expect(initialFor("cal ai")).toBe("C");
    expect(initialFor("")).toBe("");
  });
});
