import React from "react";
import { render } from "@testing-library/react-native";
import { buildSparkGeometry, Sparkline, UNRANKED_PLOT } from "./Sparkline.js";
import { ThemeProvider } from "../theme/index.js";

const box = { width: 600, height: 120, pad: 24 };

describe("buildSparkGeometry", () => {
  it("returns empty for fewer than two points (no trend to draw)", () => {
    expect(buildSparkGeometry([], box).empty).toBe(true);
    expect(buildSparkGeometry([{ rank: 5 }], box).empty).toBe(true);
  });

  it("builds a line + closed area path for a real series", () => {
    const geo = buildSparkGeometry([{ rank: 20 }, { rank: 12 }, { rank: 8 }], box);
    expect(geo.empty).toBe(false);
    expect(geo.line.startsWith("M")).toBe(true);
    expect(geo.line).toContain("L");
    expect(geo.area.endsWith("Z")).toBe(true); // area closes back to the baseline
    expect(geo.gridY).toHaveLength(3);
  });

  it("inverts the axis: a better (lower) rank plots higher on screen", () => {
    const geo = buildSparkGeometry([{ rank: 50 }, { rank: 1 }], box);
    const [first, last] = geo.dots;
    // rank 1 (better) must have a SMALLER y (higher up) than rank 50.
    expect(last!.y).toBeLessThan(first!.y);
  });

  it("labels an unranked snapshot honestly as #200+ (never a fake 0)", () => {
    const geo = buildSparkGeometry([{ rank: 30 }, { rank: null }], box);
    const last = geo.dots[geo.dots.length - 1]!;
    expect(last.label).toBe("#200+");
    // and it plots at the unranked floor, not at 0
    expect(UNRANKED_PLOT).toBe(200);
  });

  it("keeps endpoints inside the padded box", () => {
    const geo = buildSparkGeometry([{ rank: 3 }, { rank: 9 }, { rank: 200 }], box);
    for (const d of geo.dots) {
      expect(d.x).toBeGreaterThanOrEqual(box.pad - 0.5);
      expect(d.x).toBeLessThanOrEqual(box.width - box.pad + 0.5);
    }
  });
});

describe("<Sparkline />", () => {
  it("renders nothing when there's no trend", () => {
    const { toJSON } = render(
      <ThemeProvider>
        <Sparkline points={[{ rank: 5 }]} />
      </ThemeProvider>,
    );
    expect(toJSON()).toBeNull();
  });

  it("renders an accessible chart for a real series", () => {
    const { getByLabelText } = render(
      <ThemeProvider>
        <Sparkline points={[{ rank: 40 }, { rank: 22 }, { rank: 9 }]} />
      </ThemeProvider>,
    );
    expect(getByLabelText("Rank trend")).toBeTruthy();
  });
});
