import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { HeadToHead } from "../types/api.js";
import { WarRoomGrid } from "./WarRoomGrid.js";

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
