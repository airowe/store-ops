import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sparkline } from "./Sparkline.js";

describe("<Sparkline />", () => {
  it("draws a trend from >= 2 measured points", () => {
    render(<Sparkline points={[{ rank: 41 }, { rank: 22 }, { rank: 4 }]} />);
    expect(screen.getByTestId("sparkline")).toBeInTheDocument();
  });

  it("draws nothing for a single point (no trend) — honest", () => {
    const { container } = render(<Sparkline points={[{ rank: 10 }]} />);
    expect(container.querySelector('[data-testid="sparkline"]')).toBeNull();
  });

  it("draws nothing for no points", () => {
    const { container } = render(<Sparkline points={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
