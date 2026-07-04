/**
 * Sweep schedule configuration (#52) — WHEN the autonomous sweep runs for an
 * app, replacing the hardcoded "Monday 09:00 UTC for everyone".
 *
 * Architecture: Cloudflare crons are global, not per-record — so the Worker
 * cron now fires HOURLY and each app is swept only when `isSweepDue` says its
 * stored schedule matches (day/hour) AND enough of its cadence has elapsed
 * since its last sweep (the min-gap guard makes the check idempotent across
 * retries and immune to a missed hour: biweekly is day-match + ≥13d gap).
 *
 * FAIL-OPEN (the #53/comms-prefs precedent): missing row/column/table, NULL,
 * or garbage JSON → DEFAULT_SCHEDULE, which is byte-for-byte the historical
 * behavior (weekly, Monday, 09:00 UTC). User input fails LOUD at the API.
 */

export type SweepCadence = "daily" | "weekly" | "biweekly";

export type SweepSchedule = {
  cadence: SweepCadence;
  /** UTC day-of-week, 0=Sunday … 6=Saturday. Ignored for daily. */
  day: number;
  /** UTC hour, 0–23. */
  hourUtc: number;
};

/** The historical behavior: every Monday 09:00 UTC. */
export const DEFAULT_SCHEDULE: SweepSchedule = { cadence: "weekly", day: 1, hourUtc: 9 };

const CADENCES = new Set<SweepCadence>(["daily", "weekly", "biweekly"]);

/** Parse a stored JSON string — NEVER throws; garbage → the default. */
export function parseSchedule(json: string | null | undefined): SweepSchedule {
  if (!json) return { ...DEFAULT_SCHEDULE };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SCHEDULE };
  const r = raw as Record<string, unknown>;
  const cadence = CADENCES.has(r.cadence as SweepCadence)
    ? (r.cadence as SweepCadence)
    : DEFAULT_SCHEDULE.cadence;
  const day =
    typeof r.day === "number" && Number.isInteger(r.day) && r.day >= 0 && r.day <= 6
      ? r.day
      : DEFAULT_SCHEDULE.day;
  const hourUtc =
    typeof r.hourUtc === "number" && Number.isInteger(r.hourUtc) && r.hourUtc >= 0 && r.hourUtc <= 23
      ? r.hourUtc
      : DEFAULT_SCHEDULE.hourUtc;
  return { cadence, day, hourUtc };
}

/** Validate a FULL schedule from the API — user input fails LOUD. */
export function validateSchedule(
  body: unknown,
): { ok: true; schedule: SweepSchedule } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const r = body as Record<string, unknown>;
  if (!CADENCES.has(r.cadence as SweepCadence)) {
    return { ok: false, error: "cadence must be daily | weekly | biweekly" };
  }
  if (!(typeof r.day === "number" && Number.isInteger(r.day) && r.day >= 0 && r.day <= 6)) {
    return { ok: false, error: "day must be an integer 0 (Sunday) – 6 (Saturday)" };
  }
  if (
    !(typeof r.hourUtc === "number" && Number.isInteger(r.hourUtc) && r.hourUtc >= 0 && r.hourUtc <= 23)
  ) {
    return { ok: false, error: "hourUtc must be an integer 0–23" };
  }
  return {
    ok: true,
    schedule: { cadence: r.cadence as SweepCadence, day: r.day, hourUtc: r.hourUtc },
  };
}

/** Minimum elapsed time since the last sweep before the same slot can fire
 *  again — generous slack so a late cron tick never skips a legitimate slot,
 *  but a retry within the hour can't double-sweep. */
const MIN_GAP_HOURS: Record<SweepCadence, number> = {
  daily: 20,
  weekly: 6 * 24 + 12,
  biweekly: 13 * 24 + 12,
};

/**
 * Is this app's sweep due at `now`? Pure. True when:
 *   • the UTC hour matches, AND
 *   • for weekly/biweekly, the UTC day matches, AND
 *   • at least the cadence's min-gap has elapsed since `lastSweepAt`
 *     (null lastSweepAt = never swept → due on the first matching slot).
 */
export function isSweepDue(
  schedule: SweepSchedule,
  now: Date,
  lastSweepAt: string | null,
): boolean {
  if (now.getUTCHours() !== schedule.hourUtc) return false;
  if (schedule.cadence !== "daily" && now.getUTCDay() !== schedule.day) return false;
  if (!lastSweepAt) return true;
  const last = Date.parse(lastSweepAt);
  if (Number.isNaN(last)) return true; // unreadable timestamp → don't strand the app
  const elapsedHours = (now.getTime() - last) / 3_600_000;
  return elapsedHours >= MIN_GAP_HOURS[schedule.cadence];
}
