/**
 * The run page's one-line answer to "what do I do?".
 *
 * Measured on a live run before this existed: 8 equal-weight cards, 578 words,
 * 2.6 screens of scrolling — and the verdict, "nothing needs your approval",
 * appeared nowhere. The reader had to derive it by reading everything.
 *
 * The verdict is derived, never stored, so it cannot drift from the findings it
 * describes. It obeys the same rule as every number in this product: it states
 * what was measured, and says plainly when something was not read rather than
 * implying it was clean.
 */
import { describe, expect, it } from "vitest";
import { runVerdict } from "./runVerdict.js";

const summary = (over: Partial<Parameters<typeof runVerdict>[0]["summary"]> = {}) => ({
  critical: 0,
  warn: 0,
  good: 0,
  info: 0,
  total: 0,
  topImpact: null,
  label: "",
  ...over,
});

describe("runVerdict", () => {
  it("leads with the count of things that need a decision", () => {
    const v = runVerdict({ summary: summary({ critical: 1, warn: 2, total: 3 }), lockCount: 0 });
    expect(v.headline).toMatch(/3 fixes/i);
    expect(v.tone).toBe("action");
  });

  it("uses the singular for one fix", () => {
    const v = runVerdict({ summary: summary({ warn: 1, total: 1 }), lockCount: 0 });
    expect(v.headline).toMatch(/1 fix\b/i);
    expect(v.headline).not.toMatch(/fixes/i);
  });

  /**
   * The case that motivated this. `info` findings are context, not work —
   * counting them as "fixes" would manufacture urgency the run does not support.
   */
  it("says nothing needs approval when every finding is info", () => {
    const v = runVerdict({ summary: summary({ info: 4, total: 4 }), lockCount: 0 });
    expect(v.headline).toMatch(/nothing needs/i);
    expect(v.tone).toBe("clear");
    // the info findings are still acknowledged, just not as work
    expect(v.detail).toMatch(/4/);
  });

  it("acknowledges unread surfaces without calling them clean", () => {
    const v = runVerdict({ summary: summary({ info: 4, total: 4 }), lockCount: 8 });
    expect(v.detail).toMatch(/8/);
    expect(v.detail).toMatch(/can't see|couldn't read|not read/i);
    // must NOT claim the listing is fine when 8 surfaces were unreadable
    expect(v.headline).not.toMatch(/looks good|all clear|healthy/i);
  });

  /**
   * A run that read nothing has no verdict to give. Saying "nothing needs your
   * approval" there would be a claim about surfaces we never looked at — the
   * measured-or-nothing rule applied to a sentence rather than a number.
   */
  it("refuses to give an all-clear when NOTHING was read", () => {
    const v = runVerdict({ summary: summary(), lockCount: 8 });
    expect(v.tone).toBe("blocked");
    expect(v.headline).toMatch(/can't|cannot|couldn't/i);
    expect(v.headline).not.toMatch(/nothing needs/i);
  });

  it("counts only critical and warn as fixes", () => {
    const v = runVerdict({
      summary: summary({ critical: 1, warn: 1, info: 5, good: 3, total: 10 }),
      lockCount: 0,
    });
    expect(v.headline).toMatch(/2 fixes/i);
  });

  it("is deterministic — same input, same sentence", () => {
    const input = { summary: summary({ warn: 2, info: 1, total: 3 }), lockCount: 4 };
    expect(runVerdict(input)).toEqual(runVerdict(input));
  });
});
