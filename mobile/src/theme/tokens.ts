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
/** Widened palette shape (string values) so light + dark are interchangeable. */
export type Palette = Record<PaletteKey, string>;

/**
 * Light palette — the phone's half of the web's "editorial light" theme
 * (`cloud/public/styles.css :root[data-theme="light"]`). Same key set as the
 * dark `palette` so `paletteFor` stays typed; the accent green darkens
 * (#0f9d63) to clear AA contrast on light surfaces. `tokens.test.ts` pins these
 * to the web's light block, the same source-of-truth discipline as dark.
 */
export const lightPalette: Palette = {
  bg: "#f6f7f9",
  bg2: "#eceff4",
  panel: "#ffffff",
  panel2: "#f3f5f9",
  line: "#d6dceb",
  lineSoft: "#e6eaf2",
  ink: "#111621",
  dim: "#4a5468",
  faint: "#7a8398",
  signal: "#0f9d63",
  signalDim: "#0b7d4e",
  signalGlow: "rgba(15, 157, 99, 0.14)",
  brand: "#3563e0",
  warn: "#b7791f",
  bad: "#dc4a41",
};

/** The two schemes, keyed by resolved color scheme. */
export const palettes = { dark: palette, light: lightPalette } as const;

/** User preference: follow the OS, or pin one scheme. */
export type ThemeMode = "system" | "light" | "dark";
/** A resolved scheme (what actually renders). */
export type Scheme = "light" | "dark";

/** Pure: pick the palette for a resolved scheme. */
export function paletteFor(scheme: Scheme): Palette {
  return scheme === "light" ? lightPalette : palette;
}

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

/** The theme shape, with a widened `palette` so the live light/dark palette fits. */
export type Theme = Omit<typeof theme, "palette"> & { palette: Palette };
