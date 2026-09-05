import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { useFonts } from "expo-font";
import { FontGate } from "./FontGate.js";
import { fontAssets } from "./fonts.js";

jest.mock("expo-font", () => ({ useFonts: jest.fn() }));
const mockUseFonts = useFonts as unknown as jest.Mock;

/**
 * The root layout wraps the app in FontGate so no screen paints in the system
 * font for a frame and then jumps to the brand face. It must ask expo-font for
 * exactly the bundled manifest, hold children until loaded, and — if loading
 * FAILS — still render rather than blank the app: a fallback font is a
 * degraded launch, a white screen is an outage.
 */
describe("FontGate", () => {
  it("asks expo-font for the bundled manifest", () => {
    mockUseFonts.mockReturnValue([true, null]);
    render(<FontGate><Text>ready</Text></FontGate>);
    expect(mockUseFonts).toHaveBeenCalledWith(fontAssets);
  });

  it("holds children until the fonts are loaded", () => {
    mockUseFonts.mockReturnValue([false, null]);
    render(<FontGate><Text>ready</Text></FontGate>);
    expect(screen.queryByText("ready")).toBeNull();
  });

  it("renders children once loaded", () => {
    mockUseFonts.mockReturnValue([true, null]);
    render(<FontGate><Text>ready</Text></FontGate>);
    expect(screen.getByText("ready")).toBeTruthy();
  });

  it("renders children when loading FAILS — a fallback font beats a blank app", () => {
    mockUseFonts.mockReturnValue([false, new Error("font download failed")]);
    render(<FontGate><Text>ready</Text></FontGate>);
    expect(screen.getByText("ready")).toBeTruthy();
  });
});
