import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CoverageReport } from "@shipaso/api";
import { CoverageCard } from "./CoverageCard.js";

const base: CoverageReport = {
  coverageScore: 74,
  distinctTerms: 18,
  fieldFill: [
    { field: "name", limit: 30, used: 22, fillPct: 73, seen: true },
    { field: "subtitle", limit: 30, used: 0, fillPct: 0, seen: false },
    { field: "keywords", limit: 100, used: 88, fillPct: 88, seen: true },
  ],
  waste: [{ kind: "duplicate", detail: "'weather' repeats across fields", chars: 7 }],
};

describe("<CoverageCard />", () => {
  it("renders the score, distinct terms, and per-field fill", () => {
    render(<CoverageCard coverage={base} />);
    expect(screen.getByTestId("coverage-score")).toHaveTextContent("74");
    expect(screen.getByTestId("coverage-card")).toHaveTextContent("18 distinct ranking terms");
    expect(screen.getByTestId("fill-name")).toHaveTextContent("22/30 (73%)");
    expect(screen.getByTestId("fill-keywords")).toHaveTextContent("88/100 (88%)");
  });

  it("renders an UNSEEN field as 'not read' — never 0/30 (a 0 there is unknown)", () => {
    render(<CoverageCard coverage={base} />);
    const subtitle = screen.getByTestId("fill-subtitle");
    expect(subtitle).toHaveTextContent("not read");
    expect(subtitle).not.toHaveTextContent("0/30");
  });

  it("itemizes waste with its measured char cost", () => {
    render(<CoverageCard coverage={base} />);
    expect(screen.getByTestId("coverage-waste")).toHaveTextContent("'weather' repeats across fields — 7 chars");
  });

  it("shows a clean state (no manufactured inefficiency) when there's no waste", () => {
    render(<CoverageCard coverage={{ ...base, waste: [] }} />);
    expect(screen.getByTestId("coverage-clean")).toBeInTheDocument();
    expect(screen.queryByTestId("coverage-waste")).not.toBeInTheDocument();
  });
});
