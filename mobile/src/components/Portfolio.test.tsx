import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import type { PortfolioCard } from "../types/api.js";
import { PortfolioRow } from "./Portfolio.js";
import { useColorScheme } from "react-native";
import { ThemeProvider } from "../theme/index.js";
import { lightPalette, palette } from "../theme/tokens.js";

jest.mock("react-native/Libraries/Utilities/useColorScheme");
const mockColorScheme = useColorScheme as unknown as jest.Mock;

/** Flatten RN's style prop (array | object) into one resolved object. */
function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  const flatten = (s: unknown): Record<string, unknown> =>
    Array.isArray(s) ? Object.assign({}, ...s.map(flatten)) : ((s ?? {}) as Record<string, unknown>);
  return flatten(node.props.style);
}


function card(over: Partial<PortfolioCard> = {}): PortfolioCard {
  return { appId: "a1", name: "Acme", grade: "A", leadKeyword: "budget", leadRank: 3, pendingApproval: false, ...over };
}

describe("PortfolioRow (honesty)", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("dark"));
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

/**
 * The badge label sits several wrappers below the badge `View` (AppText → Text).
 * Walk up to the nearest ancestor carrying the badge's own layout signature
 * (`minWidth: 40`) rather than hard-coding a parent depth.
 */
type StyledNode = { props: { style?: unknown }; parent: StyledNode | null };

function badgeViewFor(label: string): { props: { style?: unknown } } {
  let node: StyledNode | null = screen.getByText(label) as unknown as StyledNode;
  while (node) {
    if (flatStyle(node).minWidth === 40) return node;
    node = node.parent;
  }
  throw new Error(`no badge View found for "${label}"`);
}

describe("PortfolioRow theming", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("light"));

  it("uses the LIGHT palette for the tier badge inside a light provider", () => {
    render(
      <ThemeProvider>
        <PortfolioRow card={card({ grade: "B" })} onPress={() => {}} />
      </ThemeProvider>,
    );
    // the label sits a few wrappers below the badge View — find the badge by its style
    const badge = flatStyle(badgeViewFor("B") as never);
    expect(badge.backgroundColor).toBe(lightPalette.panel2);
    expect(badge.borderColor).toBe(lightPalette.line);

    // a plain badge also tints its label with the live ink
    expect(flatStyle(screen.getByText("B") as never).color).toBe(lightPalette.ink);

    expect(lightPalette.panel2).not.toBe(palette.panel2);
    expect(lightPalette.line).not.toBe(palette.line);
    expect(lightPalette.ink).not.toBe(palette.ink);
  });

  it("a highlighted (A grade) badge uses the LIGHT signal", () => {
    render(
      <ThemeProvider>
        <PortfolioRow card={card()} onPress={() => {}} />
      </ThemeProvider>,
    );
    const badge = flatStyle(badgeViewFor("A") as never);
    expect(badge.backgroundColor).toBe(lightPalette.signal);
    expect(badge.borderColor).toBe(lightPalette.signal);
    expect(lightPalette.signal).not.toBe(palette.signal);
  });
});
