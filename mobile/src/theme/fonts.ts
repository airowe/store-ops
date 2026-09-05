/**
 * The brand typefaces the app actually bundles and loads.
 *
 * tokens.ts has declared Fraunces / Space Grotesk / JetBrains Mono as "the
 * names the app loads via expo-font" since July; nothing ever loaded them, so
 * every screen rendered in the system font. This module is the manifest:
 * exactly one static face per weight the text kinds use, from
 * `mobile/assets/fonts/` (the fonts ship in the binary — no network at launch).
 *
 * The files are the @expo-google-fonts releases copied in, not the packages:
 * their index modules `require` every weight on import, which put 39 faces
 * (3.6 MB) into the binary for the 5 the app uses. Five files here are 452 KB.
 *
 * `typeface` (tokens.ts) maps each text ROLE to a face name below. fonts.test.ts
 * proves every role points at a face that is in this manifest, so a rename in
 * either place fails a test instead of silently falling back to San Francisco.
 */
export { typeface } from "./tokens.js";

/** What `useFonts` loads. Keys are the family names components reference. */
export const fontAssets = {
  Fraunces_600SemiBold: require("../../assets/fonts/Fraunces_600SemiBold.ttf"),
  SpaceGrotesk_400Regular: require("../../assets/fonts/SpaceGrotesk_400Regular.ttf"),
  SpaceGrotesk_600SemiBold: require("../../assets/fonts/SpaceGrotesk_600SemiBold.ttf"),
  SpaceGrotesk_700Bold: require("../../assets/fonts/SpaceGrotesk_700Bold.ttf"),
  JetBrainsMono_500Medium: require("../../assets/fonts/JetBrainsMono_500Medium.ttf"),
} as const;
