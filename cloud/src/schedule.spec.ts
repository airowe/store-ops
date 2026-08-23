import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, isSweepDue, nextSweepAt, parseSchedule, validateSchedule } from "./schedule.js";

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

/**
 * nextSweepAt — the slot a user is told to expect.
 *
 * `isSweepDue` answers "should this app sweep right now", which the cron needs
 * and a UI cannot use: it is only ever true during the matching hour. Showing
 * "when next" requires computing the slot forward, which nothing did.
 *
 * Deliberately returns the next matching SLOT, not a guarantee of a run. A
 * biweekly app matches its day/hour weekly but sweeps only when the ≥13d
 * min-gap has also elapsed, so a slot can pass quietly. The UI says "next
 * check" for exactly that reason — the check happens; the run may not.
 */
describe("nextSweepAt", () => {
  const at = (iso: string) => new Date(iso);

  it("weekly: returns the next matching day+hour", () => {
    // Wed 2026-08-19 12:00Z, schedule Monday 09:00 → Mon 2026-08-24 09:00Z
    const next = nextSweepAt({ cadence: "weekly", day: 1, hourUtc: 9 }, at("2026-08-19T12:00:00Z"));
    expect(next.toISOString()).toBe("2026-08-24T09:00:00.000Z");
  });

  it("weekly: a slot LATER today is today's, not next week's", () => {
    // Monday 2026-08-24 07:00Z, schedule Monday 09:00 → same day 09:00
    const next = nextSweepAt({ cadence: "weekly", day: 1, hourUtc: 9 }, at("2026-08-24T07:00:00Z"));
    expect(next.toISOString()).toBe("2026-08-24T09:00:00.000Z");
  });

  it("weekly: a slot that already passed today rolls to next week", () => {
    // Monday 2026-08-24 10:00Z, schedule Monday 09:00 → Mon 2026-08-31
    const next = nextSweepAt({ cadence: "weekly", day: 1, hourUtc: 9 }, at("2026-08-24T10:00:00Z"));
    expect(next.toISOString()).toBe("2026-08-31T09:00:00.000Z");
  });

  it("weekly: exactly AT the slot returns the next one, never now", () => {
    // A slot that is happening is not a slot to wait for.
    const next = nextSweepAt({ cadence: "weekly", day: 1, hourUtc: 9 }, at("2026-08-24T09:00:00Z"));
    expect(next.toISOString()).toBe("2026-08-31T09:00:00.000Z");
  });

  it("daily: rolls to tomorrow once today's hour has passed", () => {
    const next = nextSweepAt({ cadence: "daily", day: 1, hourUtc: 9 }, at("2026-08-24T10:00:00Z"));
    expect(next.toISOString()).toBe("2026-08-25T09:00:00.000Z");
  });

  it("daily: ignores `day` entirely", () => {
    // day=1 (Monday) must not constrain a daily schedule; Wed → Wed.
    const next = nextSweepAt({ cadence: "daily", day: 1, hourUtc: 9 }, at("2026-08-19T07:00:00Z"));
    expect(next.toISOString()).toBe("2026-08-19T09:00:00.000Z");
  });

  it("biweekly: returns the next matching slot (which may not fire — min-gap)", () => {
    const next = nextSweepAt({ cadence: "biweekly", day: 1, hourUtc: 9 }, at("2026-08-19T12:00:00Z"));
    expect(next.toISOString()).toBe("2026-08-24T09:00:00.000Z");
  });

  it("crosses a month boundary", () => {
    // Sat 2026-08-29, schedule Tuesday 14:00 → Tue 2026-09-01
    const next = nextSweepAt({ cadence: "weekly", day: 2, hourUtc: 14 }, at("2026-08-29T00:00:00Z"));
    expect(next.toISOString()).toBe("2026-09-01T14:00:00.000Z");
  });

  it("crosses a year boundary", () => {
    // Wed 2026-12-30, schedule Sunday 00:00 → Sun 2027-01-03
    const next = nextSweepAt({ cadence: "weekly", day: 0, hourUtc: 0 }, at("2026-12-30T12:00:00Z"));
    expect(next.toISOString()).toBe("2027-01-03T00:00:00.000Z");
  });

  it("zeroes minutes and seconds — a slot is an hour, not a moment mid-hour", () => {
    const next = nextSweepAt({ cadence: "daily", day: 0, hourUtc: 9 }, at("2026-08-19T07:43:21Z"));
    expect(next.getUTCMinutes()).toBe(0);
    expect(next.getUTCSeconds()).toBe(0);
    expect(next.getUTCMilliseconds()).toBe(0);
  });

  it("always returns a time strictly in the future", () => {
    // Property check across every day/hour combination from one instant.
    const now = at("2026-08-19T12:34:56Z");
    for (let day = 0; day < 7; day++) {
      for (const hourUtc of [0, 9, 14, 23]) {
        const next = nextSweepAt({ cadence: "weekly", day, hourUtc }, now);
        expect(next.getTime()).toBeGreaterThan(now.getTime());
        expect(next.getUTCDay()).toBe(day);
        expect(next.getUTCHours()).toBe(hourUtc);
      }
    }
  });
});
