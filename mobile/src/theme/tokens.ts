/**
 * Design tokens — ported 1:1 from the web's canonical palette
 * (`cloud/public/styles.css :root`) so the phone wears the same identity:
 * "engineering terminal × editorial dark". One accent (`--signal`, the green
 * that means "the rank moved"); everything else is restraint.
 *
 * Plain values (no CSS custom properties at runtime on native). The web file
 * remains the source of truth; `tokens.test.ts` pins these to it so a palette
 * change there that isn't mirrored here fails CI.
 */

export const palette = {
  bg: "#07090e",
  bg2: "#0b0e14",
  panel: "#11151f",
  panel2: "#151a26",
  line: "#222a3b",
  lineSoft: "#1a2130",
  ink: "#eef1f7",
  dim: "#97a1b6",
  faint: "#626c83",
  /** "the rank moved" — the ONE accent. */
  signal: "#34d399",
  signalDim: "#1f8f66",
  signalGlow: "rgba(52, 211, 153, 0.18)",
  /** secondary. */
  brand: "#5b8cff",
  warn: "#fbbf24",
  bad: "#f87171",
} as const;

export type PaletteKey = keyof typeof palette;

/**
 * Font FAMILIES (the names the app loads via expo-font). Matching the web's
 * `--mono` / `--sans` / `--display` stacks; on native we load the primary face
 * and let the platform fall back.
 */
export const fonts = {
  mono: "JetBrains Mono",
  sans: "Space Grotesk",
  display: "Fraunces",
} as const;

export type FontKey = keyof typeof fonts;

export const radius = {
  base: 14,
} as const;

/** A type-scale that reads as "terminal" — tight, monospace-friendly. */
export const fontSize = {
  micro: 11,
  small: 13,
  body: 15,
  lead: 18,
  title: 24,
  display: 34,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 28,
  xxl: 44,
} as const;

/** The assembled theme a provider hands to screens. */
export const theme = {
  palette,
  fonts,
  radius,
  fontSize,
  spacing,
} as const;

export type Theme = typeof theme;
