/**
 * Theme provider — the runtime half of light/dark support. The static tokens
 * (`tokens.ts`) hold BOTH palettes; this decides which one is live and lets any
 * screen read it via `usePalette()` / switch it via `useThemeMode()`.
 *
 * Resolution: an explicit user choice (persisted) wins; "system" follows the OS
 * (`useColorScheme`). A FRESH install starts in "dark" — the brand is dark-first
 * (the landing page has no light mode, and "dark stays the default on both
 * surfaces" has been the rule since #155), but the mode used to default to
 * "system", so a light-OS phone showed the undesigned light palette on first
 * launch. Light is one tap away in Settings → Appearance. The web mirror is the
 * `data-theme` attribute + the same `store-ops:theme` storage key.
 *
 * No-provider fallback: components rendered in isolation (many unit tests mount a
 * single card with no app shell) get the dark scheme — exactly the pre-theming
 * behavior — so nothing has to wrap every test in a provider.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { paletteFor, type Palette, type Scheme, type ThemeMode } from "./tokens.js";

/** Shared with the web (`localStorage["store-ops:theme"]`). */
export const THEME_STORAGE_KEY = "store-ops:theme";

type ThemeContextValue = {
  /** User preference: system | light | dark. */
  mode: ThemeMode;
  /** Resolved scheme actually rendering. */
  scheme: Scheme;
  /** The live palette for `scheme`. */
  palette: Palette;
  /** Persisted setter. Pass "system" to defer to the OS again. */
  setMode: (mode: ThemeMode) => void;
};

const DARK_FALLBACK: ThemeContextValue = {
  mode: "system",
  scheme: "dark",
  palette: paletteFor("dark"),
  setMode: () => {},
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Pure: resolve the preference + OS scheme into the scheme to render. */
export function resolveScheme(mode: ThemeMode, system: "light" | "dark" | null | undefined): Scheme {
  if (mode === "light" || mode === "dark") return mode;
  return system === "light" ? "light" : "dark";
}

export function ThemeProvider({
  children,
  initialMode = "system",
}: {
  children: React.ReactNode;
  /**
   * The mode before the saved preference hydrates. The provider itself is
   * neutral ("system"); the APP passes "dark" at the root (`app/_layout.tsx`)
   * so a fresh install paints the brand default, and component tests keep
   * following the mocked OS. The product decision lives in one place.
   */
  initialMode?: ThemeMode;
}) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  // Hydrate the saved preference once. Until it lands we paint `initialMode`
  // (dark at the app root — the brand default and the right first frame for a
  // fresh install).
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((v) => {
        if (alive && (v === "light" || v === "dark" || v === "system")) setModeState(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function setMode(next: ThemeMode) {
    setModeState(next);
    AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => {});
  }

  // RN 0.86 widened ColorSchemeName with "unspecified" — treat it as unknown.
  const scheme = resolveScheme(mode, system === "light" || system === "dark" ? system : null);
  const value = useMemo<ThemeContextValue>(
    () => ({ mode, scheme, palette: paletteFor(scheme), setMode }),
    [mode, scheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The full theme context (mode + scheme + palette + setter). */
export function useThemeMode(): ThemeContextValue {
  return useContext(ThemeContext) ?? DARK_FALLBACK;
}

/** The live palette — the hook screens should reach for over the static import. */
export function usePalette(): Palette {
  return useThemeMode().palette;
}
