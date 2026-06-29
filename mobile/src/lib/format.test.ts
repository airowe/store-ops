import { formatCount, formatRank, formatScore, humanizeStatus, timeAgo } from "./format.js";

describe("format helpers (honesty-aware)", () => {
  it("formatRank: measured → #n, unmeasured → —", () => {
    expect(formatRank(3)).toBe("#3");
    expect(formatRank(null)).toBe("—");
    expect(formatRank(undefined)).toBe("—");
  });

  it("formatCount: a real 0 stays 0; null/undefined → —", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(12)).toBe("12");
    expect(formatCount(null)).toBe("—");
  });

  it("formatScore: null → ? (unknown), never a false 0", () => {
    expect(formatScore(null)).toBe("?");
    expect(formatScore(87.6)).toBe("88");
    expect(formatScore(0)).toBe("0");
  });

  it("timeAgo: buckets seconds/minutes/hours/days", () => {
    const now = Date.parse("2026-06-29T12:00:00Z");
    expect(timeAgo("2026-06-29T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-06-29T11:30:00Z", now)).toBe("30m ago");
    expect(timeAgo("2026-06-29T09:00:00Z", now)).toBe("3h ago");
    expect(timeAgo("2026-06-27T12:00:00Z", now)).toBe("2d ago");
    expect(timeAgo("not-a-date", now)).toBe("not-a-date");
  });

  it("humanizeStatus: snake → sentence", () => {
    expect(humanizeStatus("awaiting_approval")).toBe("Awaiting approval");
    expect(humanizeStatus("completed")).toBe("Completed");
  });
});
