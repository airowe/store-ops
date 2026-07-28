import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Opportunity } from "@shipaso/api";
import { OpportunitiesCard } from "./OpportunitiesCard.js";

const reachable: Opportunity = {
  keyword: "habit tracker",
  rank: 14,
  opportunityScore: 82,
  why: "Close to the top 10, weak competitors, gaining.",
  reachability: "now",
};

const longshot: Opportunity = {
  keyword: "productivity",
  rank: null,
  opportunityScore: 21,
  why: "Huge term, strong incumbents.",
  reachability: "longshot",
};

const unscored: Opportunity = {
  keyword: "meditation",
  rank: null,
  opportunityScore: 42.5, // the no-data constant — must NOT be shown as a real score
  scored: false,
  why: "Reachable with a push: not yet ranked.",
  reachability: "soon",
};

describe("<OpportunitiesCard />", () => {
  it("renders each opportunity with its measured rank, score, and why", () => {
    render(<OpportunitiesCard opportunities={[reachable]} />);
    expect(screen.getByTestId("opp-habit tracker")).toHaveTextContent("habit tracker");
    expect(screen.getByTestId("opp-habit tracker")).toHaveTextContent("#14");
    expect(screen.getByTestId("opp-habit tracker")).toHaveTextContent("score 82");
    expect(screen.getByText(/Close to the top 10/)).toBeInTheDocument();
  });

  it("says 'not enough data to score' instead of the no-data constant when unscored (#65)", () => {
    render(<OpportunitiesCard opportunities={[unscored]} />);
    const row = screen.getByTestId("opp-meditation");
    expect(row).toHaveTextContent("not enough data to score");
    expect(row).not.toHaveTextContent("42.5");
    expect(row).not.toHaveTextContent("score 42");
  });

  it("renders a null rank as 'not in top results' — never a fabricated position", () => {
    render(<OpportunitiesCard opportunities={[longshot]} />);
    const row = screen.getByTestId("opp-productivity");
    expect(row).toHaveTextContent("not in top results");
    expect(row).not.toHaveTextContent("#");
    // longshots are labelled, not hidden
    expect(row).toHaveTextContent("longshot");
  });

  it("renders nothing when there are no opportunities", () => {
    const { container } = render(<OpportunitiesCard opportunities={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * #388 density. On a real run (Heathen, 7dd8ee24) all 12 opportunities were
   * byte-identical apart from the keyword: same null rank, same "soon", same
   * `scored: false`, same 42.5 no-data constant, and the SAME `why` sentence
   * repeated twelve times. Across other runs the pattern holds — 8 rows carried
   * 2 distinct rationales, 12 rows carried 1.
   *
   * That is what makes the card read as a wall of text: not row count, but the
   * same sentence restated once per row. Printing an identical rationale twelve
   * times tells the reader nothing eleven of those times.
   *
   * So an identical `why` is stated ONCE for the group. The per-keyword facts
   * (rank, score, reachability) stay per row — they are the part that actually
   * varies, and hoisting those would hide measured data.
   */
  describe("repeated rationales are stated once, not once per row (#388)", () => {
    const sameWhy = (keyword: string): Opportunity => ({
      keyword,
      rank: null,
      opportunityScore: 42.5,
      scored: false,
      why: "Reachable with a push: not yet ranked, weak/absent competitors.",
      reachability: "soon",
    });

    it("hoists a rationale shared by every row into a single group line", () => {
      const ops = ["calm", "sleep", "focus", "journal"].map(sameWhy);
      render(<OpportunitiesCard opportunities={ops} />);

      // Stated once for the group…
      const shared = screen.getAllByText(/Reachable with a push/);
      expect(shared).toHaveLength(1);

      // …and every keyword still appears, with its own honest facts.
      for (const o of ops) {
        const row = screen.getByTestId(`opp-${o.keyword}`);
        expect(row).toHaveTextContent(o.keyword);
        expect(row).toHaveTextContent("not in top results");
        expect(row).toHaveTextContent("not enough data to score");
        expect(row).not.toHaveTextContent("42.5");
      }
    });

    it("keeps rationales per-row when they genuinely differ", () => {
      // Two distinct reasons must NOT be collapsed — that would drop information.
      render(<OpportunitiesCard opportunities={[reachable, longshot]} />);
      expect(screen.getByText(/Close to the top 10/)).toBeInTheDocument();
      expect(screen.getByText(/Huge term, strong incumbents/)).toBeInTheDocument();
    });

    it("does not hoist when a single row would make the group line redundant", () => {
      render(<OpportunitiesCard opportunities={[unscored]} />);
      // One row: the rationale belongs to it, stated exactly once either way.
      expect(screen.getAllByText(/Reachable with a push/)).toHaveLength(1);
      expect(screen.getByTestId("opp-meditation")).toHaveTextContent("meditation");
    });
  });

  it("shows a winnability bar for a scored keyword and none for an unscored one", () => {
    render(<OpportunitiesCard opportunities={[reachable, unscored]} />);
    // scored → bar present, width reflects the score
    const bar = screen.getByTestId(`opp-bar-${reachable.keyword}`);
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveStyle({ width: "82%" });
    // unscored → no bar
    expect(screen.queryByTestId(`opp-bar-${unscored.keyword}`)).toBeNull();
    // and still the honest text
    expect(screen.getByTestId(`opp-score-${unscored.keyword}`)).toHaveTextContent("not enough data to score");
  });
});
