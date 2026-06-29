/**
 * Theme access. The tokens are static (see `tokens.ts`), so the "provider" is a
 * thin re-export + a `useTheme` hook returning the one theme. Kept as a hook so
 * a future light/contrast variant is a drop-in without touching call sites.
 */
export { theme, palette, fonts, radius, fontSize, spacing } from "./tokens.js";
export type { Theme, PaletteKey, FontKey } from "./tokens.js";

import { theme } from "./tokens.js";
import type { Theme } from "./tokens.js";

export function useTheme(): Theme {
  return theme;
}
