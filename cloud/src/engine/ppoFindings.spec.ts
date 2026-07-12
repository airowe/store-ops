import { describe, expect, it } from "vitest";
import { isRunning, ppoFindings } from "./ppoFindings.js";
import type { AscExperimentsResult } from "./ascExperiments.js";

const read = (experiments: AscExperimentsResult["experiments"]): AscExperimentsResult => ({
  experiments,
  read: true,
});

describe("isRunning", () => {
  it("is running when started and not in a terminal state", () => {
    expect(isRunning({ id: "1", started: true, state: "ACCEPTED" })).toBe(true);
    expect(isRunning({ id: "1", started: true })).toBe(true);
  });

  it("is not running before it starts, or once ended", () => {
    expect(isRunning({ id: "1", started: false, state: "PREPARE_FOR_SUBMISSION" })).toBe(false);
    expect(isRunning({ id: "1", state: "ACCEPTED" })).toBe(false); // started undefined
    expect(isRunning({ id: "1", started: true, state: "COMPLETED" })).toBe(false);
    expect(isRunning({ id: "1", started: true, state: "STOPPED" })).toBe(false);
  });
});

describe("ppoFindings", () => {
  const ids = (r: AscExperimentsResult | undefined) => ppoFindings(r).map((f) => f.id);

  it("silent on an absent surface (keyless run)", () => {
    expect(ppoFindings(undefined)).toEqual([]);
  });

  it("silent on a DEGRADED read — never fabricates 'never tested' from a 403", () => {
    expect(ppoFindings({ experiments: [], read: false, note: "denied (403)" })).toEqual([]);
  });

  it("flags the free-test opportunity when a successful read shows zero experiments", () => {
    const out = ppoFindings(read([]));
    expect(out).toHaveLength(1);
    const f = out[0]!;
    expect(f.id).toBe("ppo_never_tested");
    expect(f.surface).toBe("ppo");
    expect(f.impact).toBe("conversion");
    expect(f.title).toMatch(/free/i);
    // an opportunity, not a manufactured defect
    expect(f.severity).toBe("info");
  });

  it("surfaces a RUNNING test as context, quoting Apple's start date + the 90-day guidance", () => {
    const out = ppoFindings(
      read([{ id: "e1", name: "Outcome captions", started: true, state: "ACCEPTED", startDate: "2026-06-01" }]),
    );
    expect(out).toHaveLength(1);
    const f = out[0]!;
    expect(f.id).toBe("ppo_experiment_running");
    expect(f.context).toBe(true);
    expect(f.detail).toContain("2026-06-01");
    expect(f.detail).toContain("Outcome captions");
    expect(f.detail).toMatch(/90 days/);
    expect(f.detail).toMatch(/confidence/i);
    // quotes Apple's state verbatim as evidence, never our own label
    expect(f.evidence).toBe("state: ACCEPTED");
  });

  it("the running fact wins even when older ended experiments are present", () => {
    expect(
      ids(
        read([
          { id: "old", started: true, state: "COMPLETED" },
          { id: "live", started: true, state: "ACCEPTED", startDate: "2026-07-01" },
        ]),
      ),
    ).toEqual(["ppo_experiment_running"]);
  });

  it("treats a never-started DRAFT as 'never tested', not fabricated history", () => {
    // a created-but-never-live experiment is not a past test
    const out = ppoFindings(read([{ id: "draft", started: false, state: "PREPARE_FOR_SUBMISSION" }]));
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("ppo_never_tested");
  });

  it("acknowledges history when tests ran before but none is running now", () => {
    const out = ppoFindings(read([{ id: "old", started: true, state: "COMPLETED" }]));
    expect(out).toHaveLength(1);
    const f = out[0]!;
    expect(f.id).toBe("ppo_no_active_experiment");
    expect(f.detail).toMatch(/before/i);
    expect(f.severity).toBe("info");
  });
});
