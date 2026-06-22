/**
 * The Worker's scheduled() entry now serves TWO cron triggers (#94):
 *   "0 9 * * 1" (Mon 09:00 UTC) → the weekly autonomous sweep (unchanged)
 *   "0 8 * * *" (daily 08:00 UTC) → the lightweight daily rank snapshot
 * It must branch on `event.cron` so the daily trigger NEVER runs the weekly sweep
 * (which would over-open approval runs) and vice-versa.
 *
 * We mock both cron handlers and assert the dispatch picks exactly one per event.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleScheduled = vi.fn(async (): Promise<void> => undefined);
const handleDailySnapshot = vi.fn(async (): Promise<void> => undefined);

vi.mock("./cron/scheduled.js", () => ({ handleScheduled: () => handleScheduled() }));
vi.mock("./cron/snapshot.js", () => ({ handleDailySnapshot: () => handleDailySnapshot() }));
vi.mock("./api/index.js", () => ({ handleApi: vi.fn() }));

import worker from "./index.js";

const env = { DB: {} } as never;
const ctx = { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("scheduled() dispatch by cron expression (#94)", () => {
  it("the daily trigger runs ONLY the snapshot, never the weekly sweep", async () => {
    await worker.scheduled!({ cron: "0 8 * * *" } as ScheduledController, env, ctx);
    expect(handleDailySnapshot).toHaveBeenCalledTimes(1);
    expect(handleScheduled).not.toHaveBeenCalled();
  });

  it("the weekly trigger runs ONLY the sweep, never the daily snapshot", async () => {
    await worker.scheduled!({ cron: "0 9 * * 1" } as ScheduledController, env, ctx);
    expect(handleScheduled).toHaveBeenCalledTimes(1);
    expect(handleDailySnapshot).not.toHaveBeenCalled();
  });

  it("an unknown cron falls back to the weekly sweep (safe default — never the snapshot-only path)", async () => {
    await worker.scheduled!({ cron: "* * * * *" } as ScheduledController, env, ctx);
    expect(handleScheduled).toHaveBeenCalledTimes(1);
    expect(handleDailySnapshot).not.toHaveBeenCalled();
  });
});
