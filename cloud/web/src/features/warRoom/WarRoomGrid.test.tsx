import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WarRoomGrid } from "./WarRoomGrid.js";
import type { HeadToHead } from "@shipaso/api";

const row = (o: Partial<HeadToHead>): HeadToHead => ({
  keyword: "todo",
  you: 5,
  youPrevious: null,
  competitors: [{ name: "Rival", rank: 9 }],
  gapToBest: -4,
  trend: "gaining",
  winning: true,
  ...o,
});

describe("<WarRoomGrid />", () => {
  it("renders your rank and a competitor's rank", () => {
    render(<WarRoomGrid rows={[row({})]} competitors={["Rival"]} />);
    expect(screen.getByTestId("you-todo")).toHaveTextContent("#5");
    expect(screen.getByTestId("war-todo")).toHaveTextContent("#9");
  });

  it("an unchecked competitor stays '—', never a guessed number", () => {
    render(<WarRoomGrid rows={[row({ competitors: [{ name: "Rival", rank: null }] })]} competitors={["Rival"]} />);
    const r = screen.getByTestId("war-todo");
    expect(r).toHaveTextContent("—");
    expect(r).not.toHaveTextContent("0");
  });

  it("shows a '—' gap when there's nothing to close", () => {
    render(<WarRoomGrid rows={[row({ gapToBest: null })]} competitors={["Rival"]} />);
    expect(screen.getByTestId("war-todo")).toHaveTextContent("—");
  });

  it("empty state when there are no rows", () => {
    render(<WarRoomGrid rows={[]} competitors={[]} />);
    expect(screen.getByText(/No head-to-head data yet/i)).toBeInTheDocument();
  });
});
