/**
 * ConversionCard (analytics-reports Phase 3) — the honesty invariants:
 *   • the figure is Apple's MEASURED downloads ÷ product-page-views; an
 *     unmeasured latest day reads "—", never a fabricated 0;
 *   • before anything is ingested there's NO card (no zero series);
 *   • movement around approved pushes is labelled correlational.
 */
import { render, screen } from "@testing-library/react-native";
import type { EngagementSurface } from "../types/api.js";
import { ConversionCard } from "./ConversionCard.js";

describe("ConversionCard", () => {
  it("renders nothing before any measured data (no zero series)", () => {
    const noData: EngagementSurface = { state: "no_data", message: "no analytics yet" };
    expect(render(<ConversionCard data={noData} />).toJSON()).toBeNull();
    expect(render(<ConversionCard data={undefined} />).toJSON()).toBeNull();
  });

  it("shows the measured latest conversion as a percentage with its date", () => {
    const data: EngagementSurface = {
      state: "measured",
      latestConversion: { date: "2026-07-18", rate: 0.234 },
      movements: [],
      days: 30,
    };
    render(<ConversionCard data={data} />);
    expect(screen.getByTestId("conv-latest")).toHaveTextContent(/23\.4%/);
    expect(screen.getByTestId("conv-latest")).toHaveTextContent(/2026-07-18/);
  });

  it("reads '—' (unmeasured) when the latest day isn't measurable, never a 0", () => {
    const data: EngagementSurface = { state: "measured", latestConversion: null, movements: [], days: 30 };
    render(<ConversionCard data={data} />);
    expect(screen.getByTestId("conv-latest")).toHaveTextContent(/—/);
    expect(screen.getByTestId("conv-latest")).toHaveTextContent(/unmeasured/);
    expect(screen.getByTestId("conv-latest")).not.toHaveTextContent(/0\.0%|0%/);
  });

  it("renders aggregate movements with the correlation caveat", () => {
    const data: EngagementSurface = {
      state: "measured",
      latestConversion: { date: "2026-07-18", rate: 0.2 },
      movements: [
        { at: "2026-07-01", source: "", before: 0.18, after: 0.22, delta: 0.04, samplesBefore: 7, samplesAfter: 7 },
        // a source-specific movement is NOT rendered (aggregate only)
        { at: "2026-07-01", source: "search", before: 0.1, after: 0.12, delta: 0.02, samplesBefore: 7, samplesAfter: 7 },
      ],
      days: 30,
    };
    render(<ConversionCard data={data} />);
    const moves = screen.getAllByTestId("conv-move");
    expect(moves).toHaveLength(1); // only the aggregate (source "") movement
    expect(screen.getByTestId("conv-movements")).toHaveTextContent(/18\.0% → 22\.0%/);
    expect(screen.getByTestId("conv-movements")).toHaveTextContent(/Correlation, not causation/i);
  });
});
