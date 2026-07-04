import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, isSweepDue, parseSchedule, validateSchedule } from "./schedule.js";

/** #52 — sweep schedule: fail-open stored reads, loud API validation, and the
 *  pure due-check that replaces "Monday 09:00 for everyone". */

describe("parseSchedule — fail-open", () => {
  it("null / garbage / wrong shape → the historical default (weekly Mon 09:00)", () => {
    for (const bad of [null, undefined, "", "nope", "[]", "42"]) {
      expect(parseSchedule(bad as never)).toEqual(DEFAULT_SCHEDULE);
    }
  });

  it("per-field coercion", () => {
    const s = parseSchedule(JSON.stringify({ cadence: "daily", day: 99, hourUtc: 14 }));
    expect(s).toEqual({ cadence: "daily", day: 1, hourUtc: 14 }); // bad day → default
  });

  it("round-trips a valid schedule", () => {
    const s = { cadence: "biweekly" as const, day: 4, hourUtc: 6 };
    expect(parseSchedule(JSON.stringify(s))).toEqual(s);
  });
});

describe("validateSchedule — loud", () => {
  it("rejects bad cadence/day/hour with the reason", () => {
    expect(validateSchedule({ cadence: "monthly", day: 1, hourUtc: 9 }).ok).toBe(false);
    expect(validateSchedule({ cadence: "weekly", day: 7, hourUtc: 9 }).ok).toBe(false);
    expect(validateSchedule({ cadence: "weekly", day: 1, hourUtc: 24 }).ok).toBe(false);
    expect(validateSchedule(null).ok).toBe(false);
  });

  it("accepts a full valid schedule", () => {
    expect(validateSchedule({ cadence: "daily", day: 0, hourUtc: 0 })).toEqual({
      ok: true,
      schedule: { cadence: "daily", day: 0, hourUtc: 0 },
    });
  });
});

describe("isSweepDue", () => {
  const MON_9 = new Date("2026-07-06T09:00:00Z"); // a Monday
  const TUE_9 = new Date("2026-07-07T09:00:00Z");
  const MON_10 = new Date("2026-07-06T10:00:00Z");

  it("default schedule fires exactly on Monday 09:00 UTC (the historical slot)", () => {
    expect(isSweepDue(DEFAULT_SCHEDULE, MON_9, null)).toBe(true);
    expect(isSweepDue(DEFAULT_SCHEDULE, TUE_9, null)).toBe(false);
    expect(isSweepDue(DEFAULT_SCHEDULE, MON_10, null)).toBe(false);
  });

  it("weekly: min-gap blocks a same-slot retry but allows next week", () => {
    const lastWeek = "2026-06-29T09:00:00Z";
    const anHourAgo = "2026-07-06T08:00:00Z";
    expect(isSweepDue(DEFAULT_SCHEDULE, MON_9, lastWeek)).toBe(true);
    expect(isSweepDue(DEFAULT_SCHEDULE, MON_9, anHourAgo)).toBe(false);
  });

  it("daily: any day at the hour, gap ≥ 20h", () => {
    const s = { cadence: "daily" as const, day: 1, hourUtc: 9 };
    expect(isSweepDue(s, TUE_9, "2026-07-06T09:00:00Z")).toBe(true); // 24h later
    expect(isSweepDue(s, TUE_9, "2026-07-07T01:00:00Z")).toBe(false); // 8h ago
    expect(isSweepDue(s, MON_10, null)).toBe(false); // wrong hour
  });

  it("biweekly: day+hour match but only every other week", () => {
    const s = { cadence: "biweekly" as const, day: 1, hourUtc: 9 };
    expect(isSweepDue(s, MON_9, "2026-06-29T09:00:00Z")).toBe(false); // 7d — not yet
    expect(isSweepDue(s, MON_9, "2026-06-22T09:00:00Z")).toBe(true); // 14d — due
  });

  it("never swept → due on the first matching slot; unreadable stamp never strands", () => {
    expect(isSweepDue(DEFAULT_SCHEDULE, MON_9, null)).toBe(true);
    expect(isSweepDue(DEFAULT_SCHEDULE, MON_9, "not a date")).toBe(true);
  });
});
