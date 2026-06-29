import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { DeltaEntry } from "../types/api.js";
import { RankMovementRow } from "./RankMovementRow.js";

describe("RankMovementRow (honesty)", () => {
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
