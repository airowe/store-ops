import React from "react";
import { Text, useColorScheme } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { ThemeProvider, resolveScheme, usePalette, useThemeMode } from "./index.js";
import { lightPalette, palette } from "./tokens.js";

jest.mock("react-native/Libraries/Utilities/useColorScheme");
const mockColorScheme = useColorScheme as unknown as jest.Mock;

describe("resolveScheme", () => {
  it("an explicit choice wins over the OS", () => {
    expect(resolveScheme("light", "dark")).toBe("light");
    expect(resolveScheme("dark", "light")).toBe("dark");
  });
  it("system follows the OS, defaulting to dark when unknown", () => {
    expect(resolveScheme("system", "light")).toBe("light");
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", null)).toBe("dark");
  });
});

function Probe() {
  const p = usePalette();
  const { scheme } = useThemeMode();
  return <Text>{scheme}:{p.bg}</Text>;
}

describe("usePalette", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("dark"));

  it("falls back to the dark palette with no provider (isolated tests)", () => {
    render(<Probe />);
    expect(screen.getByText(`dark:${palette.bg}`)).toBeTruthy();
  });

  it("inside a provider on a dark OS, renders the dark palette", () => {
    mockColorScheme.mockReturnValue("dark");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText(`dark:${palette.bg}`)).toBeTruthy();
  });

  it("inside a provider on a light OS, renders the light palette", () => {
    mockColorScheme.mockReturnValue("light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText(`light:${lightPalette.bg}`)).toBeTruthy();
    // sanity: the two palettes really are distinct
    expect(lightPalette.bg).not.toBe(palette.bg);
  });
});
