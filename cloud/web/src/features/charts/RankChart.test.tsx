import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// uPlot needs real canvas layout; mock it so the wrapper's honesty logic (empty
// vs. rendered, data prep) is what's under test, not the canvas renderer.
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

import { RankChart } from "./RankChart.js";

const p = (rank: number | null, day: number) => ({ rank, checked_at: `2026-07-0${day}T00:00:00Z` });

describe("<RankChart />", () => {
  it("draws nothing for fewer than two points (no trend)", () => {
    const { container } = render(<RankChart points={[p(3, 1)]} />);
    expect(screen.queryByTestId("rank-chart")).toBeNull();
    expect(container.firstChild).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
  });

  it("renders a chart host and constructs uPlot for a real series", () => {
    ctor.mockClear();
    render(<RankChart points={[p(20, 1), p(8, 2), p(4, 3)]} />);
    expect(screen.getByTestId("rank-chart")).toBeInTheDocument();
    expect(ctor).toHaveBeenCalledTimes(1);
    // inverted axis (rank #1 at top) + null-gap honesty are in the uPlot opts
    const [opts, data] = ctor.mock.calls[0];
    expect((opts as any).scales.y.dir).toBe(-1);
    expect((opts as any).series[1].spanGaps).toBe(false);
    // data is [timestamps, ranks] with nulls preserved
    expect((data as any[])[1]).toEqual([20, 8, 4]);
  });

  it("preserves a null rank as a gap in the series data", () => {
    ctor.mockClear();
    render(<RankChart points={[p(10, 1), p(null, 2), p(4, 3)]} />);
    const [, data] = ctor.mock.calls[0];
    expect((data as any[])[1]).toEqual([10, null, 4]);
  });
});
