/**
 * Brand-color swatch DATA for the screenshot ColorPicker. These hexes are
 * user-facing content — candidate brand colors for THEIR store creative — not
 * UI theme colors, which is why this lives outside the component (the #353
 * guard rightly bans colour literals in components; data modules are the
 * sanctioned home, and this file is in its ALLOWED list for that reason).
 */

/** Store-creative starters; custom hexes join via the picker's field. */
export const SWATCHES = [
  "#34d399", // signal green
  "#5b8cff", // brand blue
  "#fbbf24", // amber
  "#f87171", // coral
  "#a78bfa", // violet
  "#111621", // ink
] as const;

export const MAX_COLORS = 4;

/** The placeholder example shown in the custom-hex field. */
export const EXAMPLE_HEX = "#0d9488";

const HEX = /^#[0-9a-f]{6}$/;

/** Normalize user input to "#rrggbb" (leading # optional, case-folded), or
 *  null when it isn't a hex color — refused, never guessed at. */
export function normalizeBrandHex(input: string): string | null {
  const v = input.trim().toLowerCase();
  const normalized = v.startsWith("#") ? v : `#${v}`;
  return HEX.test(normalized) ? normalized : null;
}
