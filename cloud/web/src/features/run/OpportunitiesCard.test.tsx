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

describe("<OpportunitiesCard />", () => {
  it("renders each opportunity with its measured rank, score, and why", () => {
    render(<OpportunitiesCard opportunities={[reachable]} />);
    expect(screen.getByTestId("opp-habit tracker")).toHaveTextContent("habit tracker");
    expect(screen.getByTestId("opp-habit tracker")).toHaveTextContent("#14");
    expect(screen.getByTestId("opp-habit tracker")).toHaveTextContent("score 82");
    expect(screen.getByText(/Close to the top 10/)).toBeInTheDocument();
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
