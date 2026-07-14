// GENERATED from packages/tokens/tokens.json — do not edit by hand.
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
  signal: "#34d399",
  signalDim: "#1f8f66",
  signalGlow: "rgba(52, 211, 153, 0.18)",
  brand: "#5b8cff",
  warn: "#fbbf24",
  bad: "#f87171",
} as const;
export const lightPalette: Record<keyof typeof palette, string> = {
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
export type Palette = Record<keyof typeof palette, string>;
export type Scheme = "light" | "dark";
export const palettes = { dark: palette, light: lightPalette } as const;
export function paletteFor(scheme: Scheme): Palette {
  return scheme === "light" ? lightPalette : palette;
}
export const fonts = {
  "mono": "\"JetBrains Mono\", ui-monospace, \"SF Mono\", Menlo, monospace",
  "sans": "\"Space Grotesk\", -apple-system, \"Segoe UI\", Roboto, sans-serif",
  "display": "\"Fraunces\", Georgia, serif"
} as const;
export const fontSize = {
  "micro": 11,
  "small": 13,
  "body": 15,
  "lead": 18,
  "title": 24,
  "display": 34
} as const;
export const spacing = {
  "xs": 4,
  "sm": 8,
  "md": 12,
  "lg": 18,
  "xl": 28,
  "xxl": 44
} as const;
export const radius = { base: 14 } as const;
export const duration = {
  "press": 140,
  "hover": 180,
  "popover": 180,
  "dropdown": 220,
  "modal": 260
} as const;
export const easing = {
  "out": "cubic-bezier(0.23, 1, 0.32, 1)",
  "inOut": "cubic-bezier(0.77, 0, 0.175, 1)",
  "drawer": "cubic-bezier(0.32, 0.72, 0, 1)"
} as const;
