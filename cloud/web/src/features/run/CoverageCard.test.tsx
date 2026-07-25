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

// ── #322: wasted-budget items must be ACTIONABLE ────────────────────────────
//
// The issue's wall: "'for' is a low-relevance filler term" with no indication of
// WHICH field it lives in, so the customer can't act. The engine now attributes
// each waste item to its field(s); these pin that it actually reaches the page.
describe("<CoverageCard /> — #322 actionable waste", () => {
  const withWaste = (waste: CoverageReport["waste"]): CoverageReport => ({ ...base, waste });

  it("shows WHICH field a wasted term lives in", () => {
    render(
      <CoverageCard
        coverage={withWaste([
          { kind: "filler", detail: "'for' is a low-relevance filler term", chars: 3, fields: ["name"], safeToStrip: false },
        ])}
      />,
    );
    expect(screen.getByTestId("waste-fields-0")).toHaveTextContent("name");
  });

  it("names every field a term repeats across, not just the first", () => {
    render(
      <CoverageCard
        coverage={withWaste([
          { kind: "duplicate", detail: "'storm' repeats", chars: 5, fields: ["name", "keywords"], safeToStrip: false },
        ])}
      />,
    );
    const el = screen.getByTestId("waste-fields-0");
    expect(el).toHaveTextContent("name");
    expect(el).toHaveTextContent("keywords");
  });

  it("marks keyword-field filler as safe to strip", () => {
    render(
      <CoverageCard
        coverage={withWaste([
          { kind: "filler", detail: "'for' sits in your keyword field", chars: 3, fields: ["keywords"], safeToStrip: true },
        ])}
      />,
    );
    expect(screen.getByTestId("waste-safe-0")).toBeInTheDocument();
  });

  it("does NOT mark name/subtitle filler as safe to strip (it's a readability call)", () => {
    render(
      <CoverageCard
        coverage={withWaste([
          { kind: "filler", detail: "'for' is filler in your name field", chars: 3, fields: ["name"], safeToStrip: false },
        ])}
      />,
    );
    expect(screen.queryByTestId("waste-safe-0")).not.toBeInTheDocument();
  });

  it("renders waste from a legacy run with no field attribution, without inventing a field", () => {
    render(<CoverageCard coverage={withWaste([{ kind: "filler", detail: "'for' is filler", chars: 3 }])} />);
    expect(screen.getByTestId("coverage-waste")).toHaveTextContent("'for' is filler");
    expect(screen.queryByTestId("waste-fields-0")).not.toBeInTheDocument();
  });
});

describe("<CoverageCard /> — #322 keyword-field strip is SHOWN, never silent", () => {
  const strip: CoverageReport["keywordFieldStrip"] = {
    before: "for,rain,the,thunder",
    after: "rain,thunder",
    removed: ["for", "the"],
    reclaimedChars: 8,
  };

  it("shows the before and after of the safe keyword tightening", () => {
    render(<CoverageCard coverage={{ ...base, keywordFieldStrip: strip }} />);
    const el = screen.getByTestId("keyword-strip");
    expect(el).toHaveTextContent("for,rain,the,thunder");
    expect(el).toHaveTextContent("rain,thunder");
  });

  it("names the terms removed and the chars reclaimed", () => {
    render(<CoverageCard coverage={{ ...base, keywordFieldStrip: strip }} />);
    const el = screen.getByTestId("keyword-strip");
    expect(el).toHaveTextContent("for");
    expect(el).toHaveTextContent("the");
    expect(el).toHaveTextContent("8");
  });

  it("never claims the change was applied — it's a proposal the human approves", () => {
    render(<CoverageCard coverage={{ ...base, keywordFieldStrip: strip }} />);
    const text = screen.getByTestId("keyword-strip").textContent ?? "";
    expect(text.toLowerCase()).not.toMatch(/\b(applied|removed for you|we updated|pushed)\b/);
  });

  it("renders nothing when there's no safe strip to show", () => {
    render(<CoverageCard coverage={base} />);
    expect(screen.queryByTestId("keyword-strip")).not.toBeInTheDocument();
  });
});
