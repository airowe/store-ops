import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { HeadToHead } from "../types/api.js";
import { WarRoomGrid } from "./WarRoomGrid.js";
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


const competitors = ["Rivalry", "Contender"];
const rows: HeadToHead[] = [
  {
    keyword: "budget",
    you: 3,
    youPrevious: 8,
    competitors: [
      { name: "Rivalry", rank: 5 },
      { name: "Contender", rank: null }, // never checked
    ],
    gapToBest: -2,
    trend: "gaining",
    winning: true,
  },
];

describe("WarRoomGrid (honesty)", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("dark"));
  it("renders your rank and a checked competitor's rank", () => {
    render(<WarRoomGrid rows={rows} competitors={competitors} />);
    expect(screen.getByText("#3")).toBeTruthy();
    expect(screen.getByText("#5")).toBeTruthy();
  });

  it("an UNCHECKED competitor stays '—', never a guessed number", () => {
    render(<WarRoomGrid rows={rows} competitors={competitors} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("empty rows → honest empty state, no grid", () => {
    render(<WarRoomGrid rows={[]} competitors={competitors} />);
    expect(screen.getByText(/No head-to-head data yet/)).toBeTruthy();
  });
});

describe("WarRoomGrid theming", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("light"));

  it("a winning rank uses the LIGHT signal inside a light provider", () => {
    render(
      <ThemeProvider>
        <WarRoomGrid rows={rows} competitors={competitors} />
      </ThemeProvider>,
    );
    expect(flatStyle(screen.getByText("#3") as never).color).toBe(lightPalette.signal);
    expect(lightPalette.signal).not.toBe(palette.signal);
  });
});
