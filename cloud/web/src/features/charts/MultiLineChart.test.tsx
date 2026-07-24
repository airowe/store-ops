import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { drawableSeries, MultiLineChart, SERIES_COLORS, type Series } from "./MultiLineChart.js";

const s = (label: string, points: (number | null)[]): Series => ({ label, color: SERIES_COLORS[0], points });

describe("drawableSeries (pure)", () => {
  it("keeps only series with >= 2 measured points", () => {
    const kept = drawableSeries([
      s("two", [10, 6]),
      s("one", [10]),
      s("gappy", [10, null]), // only 1 measured
      s("three", [20, 12, 4]),
    ]);
    expect(kept.map((x) => x.label)).toEqual(["two", "three"]);
  });
});

describe("<MultiLineChart />", () => {
  it("renders when at least one series is drawable", () => {
    render(<MultiLineChart series={[s("Cal AI", [41, 22, 4])]} />);
    expect(screen.getByTestId("portfolio-chart")).toBeInTheDocument();
  });

  it("renders nothing when no series has a real trend", () => {
    const { container } = render(<MultiLineChart series={[s("x", [10]), s("y", [null, 5])]} />);
    expect(container.firstChild).toBeNull();
  });
});
