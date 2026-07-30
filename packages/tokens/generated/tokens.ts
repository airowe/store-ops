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
  faint: "#828ca3",
  signal: "#34d399",
  signalDim: "#1f8f66",
  signalGlow: "rgba(52, 211, 153, 0.18)",
  brand: "#5b8cff",
  warn: "#fbbf24",
  warnGlow: "rgba(251, 191, 36, 0.12)",
  warnBorder: "rgba(251, 191, 36, 0.40)",
  bad: "#f87171",
  badGlow: "rgba(248, 113, 113, 0.12)",
  navActive: "#131b2e",
  onAccent: "#05070c",
  raise: "rgba(255, 255, 255, 0.020)",
  raise2: "rgba(255, 255, 255, 0.015)",
  raise3: "rgba(255, 255, 255, 0.012)",
  onSignal: "#04140d",
  topbarBg: "rgba(7, 9, 14, 0.82)",
  overlay: "rgba(7, 9, 14, 0.74)",
  grain: "0.025",
  shadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
  brandGlow: "rgba(91, 140, 255, 0.14)",
  railBg: "#090c13",
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
  faint: "#5f6982",
  signal: "#0f9d63",
  signalDim: "#0b7d4e",
  signalGlow: "rgba(15, 157, 99, 0.14)",
  brand: "#3563e0",
  warn: "#b7791f",
  warnGlow: "rgba(183, 121, 31, 0.10)",
  warnBorder: "rgba(183, 121, 31, 0.35)",
  bad: "#dc4a41",
  badGlow: "rgba(220, 74, 65, 0.10)",
  navActive: "#eef2f9",
  onAccent: "#ffffff",
  raise: "rgba(17, 22, 33, 0.028)",
  raise2: "rgba(17, 22, 33, 0.022)",
  raise3: "rgba(17, 22, 33, 0.016)",
  onSignal: "#ffffff",
  topbarBg: "rgba(246, 247, 249, 0.82)",
  overlay: "rgba(28, 34, 46, 0.42)",
  grain: "0",
  shadow: "0 24px 60px rgba(28, 40, 66, 0.14)",
  brandGlow: "rgba(53, 99, 224, 0.10)",
  railBg: "#ffffff",
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
