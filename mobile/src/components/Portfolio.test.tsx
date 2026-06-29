import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import type { PortfolioCard } from "../types/api.js";
import { PortfolioRow } from "./Portfolio.js";

function card(over: Partial<PortfolioCard> = {}): PortfolioCard {
  return { appId: "a1", name: "Acme", grade: "A", leadKeyword: "budget", leadRank: 3, pendingApproval: false, ...over };
}

describe("PortfolioRow (honesty)", () => {
  it("shows grade + lead keyword/rank", () => {
    render(<PortfolioRow card={card()} onPress={() => {}} />);
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText(/budget: #3/)).toBeTruthy();
  });

  it("unaudited app → '—' grade; untracked → 'no tracked keyword'", () => {
    render(<PortfolioRow card={card({ grade: null, leadKeyword: null, leadRank: null })} onPress={() => {}} />);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("no tracked keyword")).toBeTruthy();
  });

  it("press routes by app id", () => {
    const onPress = jest.fn();
    render(<PortfolioRow card={card()} onPress={onPress} />);
    fireEvent.press(screen.getByTestId("portfolio-a1"));
    expect(onPress).toHaveBeenCalledWith("a1");
  });
});
