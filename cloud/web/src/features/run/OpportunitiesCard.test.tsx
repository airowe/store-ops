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
    /**
     * MEASURED rows that happen to share a rationale. Unmeasured rows collapse
     * into the #396 summary instead, which is a different behaviour — using
     * them here would test collapsing, not hoisting.
     */
    const sameWhy = (keyword: string, rank: number): Opportunity => ({
      keyword,
      rank,
      opportunityScore: 70,
      why: "Reachable with a push: not yet ranked, weak/absent competitors.",
      reachability: "soon",
    });

    it("hoists a rationale shared by every row into a single group line", () => {
      const ops = [
        sameWhy("calm", 11),
        sameWhy("sleep", 12),
        sameWhy("focus", 13),
        sameWhy("journal", 14),
      ];
      render(<OpportunitiesCard opportunities={ops} />);

      // Stated once for the group…
      const shared = screen.getAllByText(/Reachable with a push/);
      expect(shared).toHaveLength(1);

      // …and every keyword still appears, with its own measured facts.
      for (const o of ops) {
        const row = screen.getByTestId(`opp-${o.keyword}`);
        expect(row).toHaveTextContent(o.keyword);
        expect(row).toHaveTextContent(`#${o.rank}`);
        expect(row).toHaveTextContent("score 70");
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

  /**
   * #396: rows with NOTHING measured are summarised in one line, not printed
   * once each.
   *
   * On the Heathen run all 12 opportunities had `rank: null` and
   * `scored: false`, so every row rendered the identical three phrases
   * "not in top results · reachable soon · not enough data to score". #395
   * removed the repeated sentence; the repeated ROW remained, because there is
   * genuinely no per-keyword signal to show. Twelve rows saying "we have not
   * measured this" is one fact, stated twelve times.
   *
   * Measured-or-nothing is preserved in the direction that matters: this states
   * the absence of data MORE plainly, and it can never hide a measured value —
   * a row is only summarised when rank is null AND scored is false. Anything
   * with a real rank or a real score keeps its own row.
   */
  describe("keywords with nothing measured are summarised, not repeated (#396)", () => {
    const unmeasured = (keyword: string): Opportunity => ({
      keyword,
      rank: null,
      opportunityScore: 42.5,
      scored: false,
      why: "Reachable with a push: not yet ranked, weak/absent competitors.",
      reachability: "soon",
    });

    it("replaces a block of unmeasured rows with one line naming the count", () => {
      const ops = ["affirmation", "anxiety", "breathe", "calm"].map(unmeasured);
      render(<OpportunitiesCard opportunities={ops} />);

      const summary = screen.getByTestId("opp-unmeasured");
      expect(summary).toHaveTextContent("4");
      // The keywords are still named — summarising must not hide WHICH terms.
      for (const o of ops) expect(summary).toHaveTextContent(o.keyword);
      // …but no longer as one row each.
      for (const o of ops) expect(screen.queryByTestId(`opp-${o.keyword}`)).toBeNull();
      // The no-data constant is still never shown as a score.
      expect(summary).not.toHaveTextContent("42.5");
      expect(summary).not.toHaveTextContent("score 42");
    });

    it("never summarises a row with a measured rank or score", () => {
      render(
        <OpportunitiesCard
          opportunities={[reachable, longshot, unmeasured("calm"), unmeasured("sleep")]}
        />,
      );
      // reachable has rank 14 + score 82 — measured, keeps its row.
      expect(screen.getByTestId("opp-habit tracker")).toHaveTextContent("#14");
      expect(screen.getByTestId("opp-habit tracker")).toHaveTextContent("score 82");
      // longshot has NO `scored` field, so its score of 21 is real: unranked is
      // not the same as unmeasured, and it must keep its row and its label.
      expect(screen.getByTestId("opp-productivity")).toHaveTextContent("not in top results");
      expect(screen.getByTestId("opp-productivity")).toHaveTextContent("longshot");
      expect(screen.getByTestId("opp-productivity")).toHaveTextContent("score 21");
      // Only the genuinely unmeasured pair is summarised.
      expect(screen.queryByTestId("opp-calm")).toBeNull();
      expect(screen.queryByTestId("opp-sleep")).toBeNull();
      const summary = screen.getByTestId("opp-unmeasured");
      expect(summary).toHaveTextContent("calm");
      expect(summary).toHaveTextContent("sleep");
      expect(summary).toHaveTextContent("2");
    });

    it("keeps a lone unmeasured keyword as a normal row", () => {
      // A summary line for one item is longer than the row it replaces.
      render(<OpportunitiesCard opportunities={[unscored]} />);
      expect(screen.getByTestId("opp-meditation")).toHaveTextContent("meditation");
      expect(screen.queryByTestId("opp-unmeasured")).toBeNull();
    });

    it("still renders the card when every row is unmeasured", () => {
      render(<OpportunitiesCard opportunities={["a", "b", "c"].map(unmeasured)} />);
      expect(screen.getByTestId("opportunities-card")).toBeInTheDocument();
      expect(screen.getByTestId("opp-unmeasured")).toBeInTheDocument();
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
