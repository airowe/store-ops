import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { CoverageReport } from "../types/api.js";
import { CoverageGauge } from "./CoverageGauge.js";

function coverage(over: Partial<CoverageReport> = {}): CoverageReport {
  return {
    coverageScore: 78,
    usedChars: { name: 28, subtitle: 0, keywords: 0 },
    fieldFill: [
      { field: "name", limit: 30, used: 28, fillPct: 93, seen: true },
      { field: "subtitle", limit: 30, used: 0, fillPct: 0, seen: false },
      { field: "keywords", limit: 100, used: 0, fillPct: 0, seen: false },
    ],
    distinctTerms: 9,
    waste: [{ kind: "duplicate", detail: "'weather' repeats — 7 wasted chars", chars: 7 }],
    ...over,
  };
}

describe("CoverageGauge (honesty: unseen ≠ 0)", () => {
  it("shows the score + distinct terms", () => {
    render(<CoverageGauge coverage={coverage()} />);
    expect(screen.getByText("78/100")).toBeTruthy();
    expect(screen.getByText(/9 distinct ranking terms/)).toBeTruthy();
  });

  it("a seen field shows used/limit; an UNSEEN field reads UNKNOWN, not 0/limit", () => {
    render(<CoverageGauge coverage={coverage()} />);
    expect(screen.getByText("28/30")).toBeTruthy(); // name (seen)
    // subtitle + keywords are unseen → UNKNOWN, and NOT "0/30"/"0/100"
    expect(screen.getAllByText(/UNKNOWN/).length).toBe(2);
    expect(screen.queryByText("0/30")).toBeNull();
    expect(screen.queryByText("0/100")).toBeNull();
  });

  it("lists itemized waste, or a clean message when there is none", () => {
    render(<CoverageGauge coverage={coverage()} />);
    expect(screen.getByText(/weather' repeats/)).toBeTruthy();
    render(<CoverageGauge coverage={coverage({ waste: [] })} />);
    expect(screen.getByText(/No wasted characters/)).toBeTruthy();
  });
});
