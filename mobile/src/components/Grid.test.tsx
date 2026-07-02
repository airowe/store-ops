import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { Grid } from "./Grid.js";

function items(n: number) {
  return Array.from({ length: n }, (_, i) => <Text key={i} testID={`item-${i}`}>{`card ${i}`}</Text>);
}

describe("Grid (responsive card layout)", () => {
  it("1 column (phone) → one row per item, all rendered", () => {
    render(<Grid columns={1}>{items(3)}</Grid>);
    expect(screen.getAllByTestId("grid-row")).toHaveLength(3);
    expect(screen.getByTestId("item-0")).toBeTruthy();
    expect(screen.getByTestId("item-2")).toBeTruthy();
  });

  it("2 columns (iPad) → items grouped two per row", () => {
    render(<Grid columns={2}>{items(4)}</Grid>);
    expect(screen.getAllByTestId("grid-row")).toHaveLength(2);
    // all four still render
    for (let i = 0; i < 4; i++) expect(screen.getByTestId(`item-${i}`)).toBeTruthy();
  });

  it("a short final row still renders its item (padded, not stretched/dropped)", () => {
    render(<Grid columns={2}>{items(3)}</Grid>);
    expect(screen.getAllByTestId("grid-row")).toHaveLength(2); // [0,1] then [2]
    expect(screen.getByTestId("item-2")).toBeTruthy();
  });

  it("3 columns (large iPad)", () => {
    render(<Grid columns={3}>{items(7)}</Grid>);
    expect(screen.getAllByTestId("grid-row")).toHaveLength(3); // 3+3+1
    for (let i = 0; i < 7; i++) expect(screen.getByTestId(`item-${i}`)).toBeTruthy();
  });
});
