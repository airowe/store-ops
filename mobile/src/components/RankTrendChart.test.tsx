import React from "react";
import { render } from "@testing-library/react-native";
import { RankTrendChart } from "./RankTrendChart.js";

// react-native-graph is mocked in jest.setup (it needs Skia at runtime); these
// tests are about the honest data-gating + caption, not the GPU renderer.
const p = (rank: number | null, day: number) => ({ rank, total: null, checked_at: `2026-07-0${day}T00:00:00Z` });

describe("RankTrendChart", () => {
  it("renders nothing for a single measured point (no trend)", () => {
    const { toJSON } = render(<RankTrendChart points={[p(5, 1)]} />);
    expect(toJSON()).toBeNull();
  });

  it("renders the graph for a real series, with the latest rank in the readout", () => {
    const { getByTestId } = render(<RankTrendChart points={[p(20, 1), p(8, 2)]} />);
    expect(getByTestId("rank-trend-chart")).toBeTruthy();
    expect(getByTestId("line-graph")).toBeTruthy();
    // default readout = latest measured point (#8 on the 2nd)
    expect(getByTestId("scrub-readout").props.children.join("")).toContain("#8");
  });

  it("notes omitted unmeasured points in the caption (honesty)", () => {
    const { getByText } = render(<RankTrendChart points={[p(20, 1), p(null, 2), p(8, 3)]} />);
    expect(getByText(/1 unmeasured point omitted/)).toBeTruthy();
  });
});
