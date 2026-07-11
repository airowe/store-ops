import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EngagementSurface } from "@shipaso/api";
import { ConversionCard } from "./ConversionCard.js";

describe("<ConversionCard />", () => {
  it("renders nothing before anything is ingested (no zero series)", () => {
    const { container } = render(<ConversionCard data={{ state: "no_data", message: "x" }} />);
    expect(container.firstChild).toBeNull();
    expect(render(<ConversionCard data={undefined} />).container.firstChild).toBeNull();
  });

  it("shows the measured conversion percentage + date", () => {
    const data: EngagementSurface = { state: "measured", latestConversion: { date: "2026-07-02", rate: 0.2 }, movements: [], days: 2 };
    render(<ConversionCard data={data} />);
    expect(screen.getByTestId("conv-latest")).toHaveTextContent("20.0%");
    expect(screen.getByTestId("conv-latest")).toHaveTextContent("as of 2026-07-02");
    expect(screen.queryByTestId("conv-movements")).toBeNull();
  });

  it("reads '—' unmeasured (never a fake 0) when the latest day isn't measurable", () => {
    const data: EngagementSurface = { state: "measured", latestConversion: null, movements: [], days: 1 };
    render(<ConversionCard data={data} />);
    expect(screen.getByTestId("conv-latest")).toHaveTextContent("—");
    expect(screen.getByTestId("conv-latest")).toHaveTextContent("unmeasured");
    expect(screen.getByTestId("conv-latest")).not.toHaveTextContent("0.0%");
  });

  it("renders the aggregate movement with the correlation caveat", () => {
    const data: EngagementSurface = {
      state: "measured",
      latestConversion: { date: "2026-07-20", rate: 0.2 },
      movements: [
        { at: "2026-07-15", runId: "run1", source: "", before: 0.1, after: 0.2, delta: 0.1, samplesBefore: 14, samplesAfter: 14 },
        { at: "2026-07-15", runId: "run1", source: "App Store Search", before: 0.1, after: 0.2, delta: 0.1, samplesBefore: 14, samplesAfter: 14 },
      ],
      days: 28,
    };
    render(<ConversionCard data={data} />);
    const moves = screen.getAllByTestId("conv-move");
    expect(moves).toHaveLength(1); // only the aggregate is shown, not per-source
    expect(moves[0]).toHaveTextContent("conversion 10.0% → 20.0%");
    expect(moves[0]).toHaveTextContent("around 2026-07-15 · 14/14d");
    expect(screen.getByText(/Correlation, not causation/i)).toBeInTheDocument();
  });
});
