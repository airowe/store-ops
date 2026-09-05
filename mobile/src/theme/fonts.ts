/**
 * The brand typefaces the app actually bundles and loads.
 *
 * tokens.ts has declared Fraunces / Space Grotesk / JetBrains Mono as "the
 * names the app loads via expo-font" since July; nothing ever loaded them, so
 * every screen rendered in the system font. This module is the manifest:
 * one static face per weight the text kinds use, from the @expo-google-fonts
 * packages (the fonts ship in the binary — no network at launch).
 *
 * `typeface` (tokens.ts) maps each text ROLE to a face name below. fonts.test.ts
 * proves every role points at a face that is in this manifest, so a rename in
 * either place fails a test instead of silently falling back to San Francisco.
 */
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";

export { typeface } from "./tokens.js";

/** What `useFonts` loads. Keys are the family names components reference. */
export const fontAssets = {
  Fraunces_600SemiBold,
  SpaceGrotesk_400Regular,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  JetBrainsMono_500Medium,
} as const;
