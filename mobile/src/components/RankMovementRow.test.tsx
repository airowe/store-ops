import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { DeltaEntry } from "../types/api.js";
import { RankMovementRow } from "./RankMovementRow.js";
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


describe("RankMovementRow (honesty)", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("dark"));
  it("measured prev→cur shows the delta with a direction arrow", () => {
    const e: DeltaEntry = { keyword: "budget", current: 4, previous: 9, delta: 5, direction: "up" };
    render(<RankMovementRow entry={e} />);
    expect(screen.getByText("#4")).toBeTruthy();
    expect(screen.getByText("▲5")).toBeTruthy();
  });

  it("single-snapshot (no previous) → tagged 'new', NO fabricated delta", () => {
    const e: DeltaEntry = { keyword: "budget", current: 7, previous: null, delta: null, direction: "flat" };
    render(<RankMovementRow entry={e} />);
    expect(screen.getByText("#7")).toBeTruthy();
    expect(screen.getByText("new")).toBeTruthy();
  });

  it("unchecked current → '—', never a 0", () => {
    const e: DeltaEntry = { keyword: "budget", current: null, previous: null, delta: null, direction: "flat" };
    render(<RankMovementRow entry={e} />);
    // current rank is "—" and the movement chip is "—" too — no zero anywhere
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("0")).toBeNull();
  });
});

describe("RankMovementRow theming", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("light"));

  it("an upward move uses the LIGHT signal inside a light provider", () => {
    const e: DeltaEntry = { keyword: "budget", current: 4, previous: 9, delta: 5, direction: "up" };
    render(
      <ThemeProvider>
        <RankMovementRow entry={e} />
      </ThemeProvider>,
    );
    expect(flatStyle(screen.getByText("▲5") as never).color).toBe(lightPalette.signal);
    expect(lightPalette.signal).not.toBe(palette.signal);
  });

  it("a downward move uses the LIGHT bad colour", () => {
    const e: DeltaEntry = { keyword: "budget", current: 9, previous: 4, delta: -5, direction: "down" };
    render(
      <ThemeProvider>
        <RankMovementRow entry={e} />
      </ThemeProvider>,
    );
    expect(flatStyle(screen.getByText("▼5") as never).color).toBe(lightPalette.bad);
    expect(lightPalette.bad).not.toBe(palette.bad);
  });
});
