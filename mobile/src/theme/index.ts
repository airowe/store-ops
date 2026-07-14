/**
 * Theme access. Static tokens live in `tokens.ts`; the live light/dark palette is
 * supplied at runtime by `ThemeProvider`. Screens read the active palette with
 * `usePalette()` (preferred). The static `palette` export remains the DARK
 * baseline for module-scope use (StyleSheet defaults, tests) and stays
 * backward-compatible.
 */
export { theme, palette, lightPalette, palettes, paletteFor, fonts, radius, fontSize, spacing } from "./tokens.js";
export type { Theme, Palette, PaletteKey, FontKey, ThemeMode, Scheme } from "./tokens.js";
export { ThemeProvider, usePalette, useThemeMode, resolveScheme, THEME_STORAGE_KEY } from "./ThemeProvider.js";

import { theme } from "./tokens.js";
import type { Theme } from "./tokens.js";
import { usePalette } from "./ThemeProvider.js";

/**
 * The assembled theme with the LIVE palette swapped in. Palette-aware: inside a
 * `ThemeProvider` it tracks light/dark; outside one it falls back to dark.
 *
 * Currently unused (screens reach for `usePalette()` directly) — React Doctor
 * flags it as an unused export. Kept deliberately: deleting it turns this module
 * into a pure re-export barrel, which trips `no-barrel-import` across all 28
 * files that import from `../theme/index.js`. Net worse. Revisit only alongside
 * a decision about the theme barrel itself.
 */
export function useTheme(): Theme {
  return { ...theme, palette: usePalette() };
}
