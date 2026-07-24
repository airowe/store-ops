import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { coverage, Gauge } from "./Gauge.js";

describe("coverage (pure)", () => {
  it("counts only measured ranks in the top 10 over the measured denominator", () => {
    // #4 and #7 are in top 10; #24 is not; null is unmeasured (excluded from both)
    const c = coverage([4, 7, 24, null]);
    expect(c.inTop10).toBe(2);
    expect(c.measured).toBe(3); // the null does not count in the denominator
    expect(c.label).toBe("67%"); // 2/3
  });

  it("reads '—' when nothing is measured — never a fabricated 0%", () => {
    const c = coverage([null, null]);
    expect(c.measured).toBe(0);
    expect(c.fraction).toBe(0);
    expect(c.label).toBe("—");
  });

  it("is 100% when every measured rank is top 10", () => {
    expect(coverage([1, 3, 10]).label).toBe("100%");
  });
});

describe("<Gauge />", () => {
  it("renders the label and does not overflow the dash beyond the circle", () => {
    render(<Gauge fraction={0.61} label="61%" />);
    expect(screen.getByTestId("gauge")).toHaveTextContent("61%");
  });

  it("clamps an out-of-range fraction without throwing", () => {
    render(<Gauge fraction={1.5} label="100%" />);
    expect(screen.getByTestId("gauge")).toBeInTheDocument();
  });
});
