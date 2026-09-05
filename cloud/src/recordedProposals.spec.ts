import { describe, expect, it } from "vitest";
import { countProposedFields, recordedProposalsSince, weekBefore } from "./recordedProposals.js";

/**
 * #493 — `detected` runs carry real proposals that were surfaced nowhere. The
 * count must be honest: only fields that actually changed, only runs in the
 * window, only `detected` runs (awaiting_approval ones already have a gate).
 */
const NOW = new Date("2026-09-05T12:00:00Z");
const trace = (proposed: Record<string, string>, current: Record<string, string> = {}) =>
  JSON.stringify({ proposedCopy: proposed, currentCopy: current });
const run = (status: string, daysAgo: number, reasoning_json: string) => ({
  status,
  created_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  reasoning_json,
});

describe("countProposedFields", () => {
  it("counts only proposed fields that differ from the current copy", () => {
    expect(
      countProposedFields(
        { name: "Acme", subtitle: "Do the thing", keywords: "a,b,c" },
        { name: "Acme", subtitle: "Do things", keywords: "a,b,c" },
      ),
    ).toBe(1);
  });

  it("an empty proposed field is not a proposal; a missing current field is", () => {
    expect(countProposedFields({ name: "", subtitle: "  " }, {})).toBe(0);
    expect(countProposedFields({ name: "Acme", subtitle: "New" }, {})).toBe(2);
    expect(countProposedFields(null, {})).toBe(0);
  });
});

describe("recordedProposalsSince", () => {
  it("sums proposals across detected runs in the window and reports the window", () => {
    const out = recordedProposalsSince(
      [
        run("detected", 1, trace({ name: "A", subtitle: "B", keywords: "c" }, { name: "A" })),
        run("detected", 3, trace({ subtitle: "S", description: "D" })),
      ],
      weekBefore(NOW),
    );
    expect(out).toEqual({ runs: 2, proposals: 4, since: weekBefore(NOW).toISOString() });
  });

  it("ignores runs outside the window and runs that are not detected", () => {
    const out = recordedProposalsSince(
      [
        run("detected", 9, trace({ name: "old" })),
        run("awaiting_approval", 1, trace({ name: "gated", subtitle: "gated" })),
        run("shipped", 1, trace({ name: "done" })),
      ],
      weekBefore(NOW),
    );
    expect(out.runs).toBe(0);
    expect(out.proposals).toBe(0);
  });

  it("a run whose trace cannot be parsed contributes nothing — never a guessed number", () => {
    const out = recordedProposalsSince([run("detected", 1, "{not json")], weekBefore(NOW));
    expect(out).toMatchObject({ runs: 1, proposals: 0 });
  });

  it("zero is a measurement: no detected runs → 0 runs, 0 proposals", () => {
    expect(recordedProposalsSince([], weekBefore(NOW))).toMatchObject({ runs: 0, proposals: 0 });
  });
});
