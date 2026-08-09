/**
 * ColorPicker — pins:
 *   • picks toggle and report upward in pick order, first pick badged primary,
 *   • a valid custom hex joins the palette (normalized, # optional),
 *   • a malformed hex is refused with the reason — never quietly "corrected",
 *   • the MAX_COLORS cap refuses a fifth pick with the reason,
 *   • no picks states the neutral default.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ColorPicker, MAX_COLORS, SWATCHES } from "./ColorPicker.js";

function Harness({ initial = [] as string[] }) {
  const [colors, setColors] = React.useState<string[]>(initial);
  return <ColorPicker colors={colors} onChange={setColors} />;
}

describe("ColorPicker", () => {
  it("toggles picks in order and badges the first as primary", () => {
    render(<Harness />);
    fireEvent.press(screen.getByTestId("color-5b8cff"));
    fireEvent.press(screen.getByTestId("color-34d399"));
    // primary badge sits on the FIRST pick (blue), not the swatch order
    const blue = screen.getByTestId("color-5b8cff");
    expect(blue.props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("color-primary-badge")).toBeTruthy();
    // unpick blue → green becomes the only (and primary) pick
    fireEvent.press(blue);
    expect(screen.getByTestId("color-34d399").props.accessibilityState.selected).toBe(true);
  });

  it("adds a valid custom hex (normalized, # optional)", () => {
    render(<Harness />);
    fireEvent.changeText(screen.getByTestId("color-custom-hex"), "0D9488");
    fireEvent.press(screen.getByTestId("color-custom-add"));
    expect(screen.getByTestId("color-0d9488").props.accessibilityState.selected).toBe(true);
  });

  it("refuses a malformed hex with the reason", () => {
    render(<Harness />);
    fireEvent.changeText(screen.getByTestId("color-custom-hex"), "greenish");
    fireEvent.press(screen.getByTestId("color-custom-add"));
    expect(screen.getByTestId("color-note")).toBeTruthy();
    expect(screen.getByText(/isn’t a #rrggbb color/)).toBeTruthy();
    expect(screen.queryByTestId("color-greenish")).toBeNull();
  });

  it(`refuses pick ${MAX_COLORS + 1} with the reason`, () => {
    render(<Harness />);
    for (const hex of SWATCHES.slice(0, MAX_COLORS)) {
      fireEvent.press(screen.getByTestId(`color-${hex.slice(1)}`));
    }
    fireEvent.press(screen.getByTestId(`color-${SWATCHES[MAX_COLORS]!.slice(1)}`));
    expect(screen.getByText(new RegExp(`Up to ${MAX_COLORS} colors`))).toBeTruthy();
    expect(
      screen.getByTestId(`color-${SWATCHES[MAX_COLORS]!.slice(1)}`).props.accessibilityState.selected,
    ).toBe(false);
  });

  it("states the neutral default when nothing is picked", () => {
    render(<Harness />);
    expect(screen.getByText(/No colors picked — the set stays neutral/)).toBeTruthy();
  });
});
