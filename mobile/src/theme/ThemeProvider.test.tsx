import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Text, useColorScheme } from "react-native";
import { render, screen } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemeProvider, resolveScheme, usePalette, useThemeMode } from "./index.js";
import { THEME_STORAGE_KEY } from "./ThemeProvider.js";
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

  // A fresh install paints DARK regardless of the OS. The brand is dark-first
  // (the landing page has no light mode) and "dark stays the default on both
  // surfaces" was the stated rule since #155 — but mode defaulted to "system",
  // so a light-OS phone showed the undesigned light palette on first launch.
  // Light remains one tap away: Settings → Appearance → System or Light.
  it("a fresh install on a light OS still paints dark first (initialMode=dark, as the app root passes)", () => {
    mockColorScheme.mockReturnValue("light");
    render(
      <ThemeProvider initialMode="dark">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText(`dark:${palette.bg}`)).toBeTruthy();
    // sanity: the two palettes really are distinct
    expect(lightPalette.bg).not.toBe(palette.bg);
  });

  it("the app root actually passes initialMode=dark — the decision lives there, not in the provider", () => {
    const layout = readFileSync(join(__dirname, "../../app/_layout.tsx"), "utf8");
    expect(layout).toMatch(/<ThemeProvider initialMode="dark">/);
  });

  it("inside a neutral provider on a light OS, renders the light palette (component tests rely on this)", () => {
    mockColorScheme.mockReturnValue("light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText(`light:${lightPalette.bg}`)).toBeTruthy();
  });

  it("a saved 'system' preference on a light OS renders the light palette", async () => {
    mockColorScheme.mockReturnValue("light");
    await AsyncStorage.setItem(THEME_STORAGE_KEY, "system");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(await screen.findByText(`light:${lightPalette.bg}`)).toBeTruthy();
  });

  it("a saved 'light' preference renders light even on a dark OS", async () => {
    mockColorScheme.mockReturnValue("dark");
    await AsyncStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(await screen.findByText(`light:${lightPalette.bg}`)).toBeTruthy();
  });
});
