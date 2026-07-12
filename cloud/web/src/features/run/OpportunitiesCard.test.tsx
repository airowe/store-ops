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
});
