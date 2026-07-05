import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { toRankSeries } from "@shipaso/honesty";

// uPlot needs real canvas layout; mock it so the wrapper's honesty logic (empty
// vs. rendered, data prep, readout) is what's under test, not the renderer.
const ctor = vi.fn();
vi.mock("uplot", () => ({
  default: class {
    constructor(opts: unknown, data: unknown, host: unknown) {
      ctor(opts, data, host);
    }
    destroy() {}
  },
}));
vi.mock("uplot/dist/uPlot.min.css", () => ({}));

import { RankChart, readoutAt, defaultReadout, formatReadout } from "./RankChart.js";

const p = (rank: number | null, day: number) => ({ rank, checked_at: `2026-07-0${day}T00:00:00Z` });

describe("readout helpers (pure)", () => {
  const s = toRankSeries([p(20, 1), p(null, 2), p(8, 3)]);

  it("readoutAt returns the point (incl. null) at an index, else null off-chart", () => {
    expect(readoutAt(s, 0)!.rank).toBe(20);
    expect(readoutAt(s, 1)!.rank).toBe(null); // unmeasured stays null
    expect(readoutAt(s, null)).toBe(null);
    expect(readoutAt(s, 99)).toBe(null);
  });

  it("defaultReadout picks the latest MEASURED point (skips a trailing gap)", () => {
    const trailingGap = toRankSeries([p(20, 1), p(8, 2), p(null, 3)]);
    expect(defaultReadout(trailingGap)!.rank).toBe(8);
  });

  it("formatReadout renders '#rank · date', and '—' for an unmeasured point", () => {
    expect(formatReadout({ rank: 8, t: Date.parse("2026-07-03T00:00:00Z") / 1000 })).toBe("#8 · 2026-07-03");
    expect(formatReadout({ rank: null, t: Date.parse("2026-07-02T00:00:00Z") / 1000 })).toBe("— · 2026-07-02");
    expect(formatReadout(null)).toBe("");
  });
});

describe("<RankChart />", () => {
  it("draws nothing for fewer than two points (no trend)", () => {
    render(<RankChart points={[p(3, 1)]} />);
    expect(screen.queryByTestId("rank-chart")).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
  });

  it("renders the chart + a default readout (latest measured), with honest uPlot opts", () => {
    ctor.mockClear();
    render(<RankChart points={[p(20, 1), p(8, 2), p(4, 3)]} />);
    expect(screen.getByTestId("rank-chart")).toBeInTheDocument();
    expect(screen.getByTestId("chart-readout")).toHaveTextContent("#4 · 2026-07-03");
    const [opts, data] = ctor.mock.calls[0];
    expect((opts as any).scales.y.dir).toBe(-1); // inverted axis
    expect((opts as any).series[1].spanGaps).toBe(false); // null gaps
    expect((opts as any).hooks.setCursor).toHaveLength(1); // scrubber wired
    expect((data as any[])[1]).toEqual([20, 8, 4]);
  });

  it("preserves a null rank as a gap in the series data", () => {
    ctor.mockClear();
    render(<RankChart points={[p(10, 1), p(null, 2), p(4, 3)]} />);
    const [, data] = ctor.mock.calls[0];
    expect((data as any[])[1]).toEqual([10, null, 4]);
  });
});
