import { fontAssets, typeface } from "./fonts.js";
import { fonts } from "./tokens.js";

/**
 * The brand typefaces were declared in tokens.ts for months ("the names the app
 * loads via expo-font") and never loaded — no font files, no useFonts, and
 * AppText never applied them, so every screen rendered in the system font.
 * This pins the whole chain: every face a text kind references is a face the
 * app actually bundles and loads, and each family token has a loaded face.
 */
describe("brand typefaces", () => {
  it("bundles one face per weight the text kinds use, and nothing else", () => {
    expect(Object.keys(fontAssets).sort()).toEqual(
      [
        "Fraunces_600SemiBold",
        "JetBrainsMono_500Medium",
        "SpaceGrotesk_400Regular",
        "SpaceGrotesk_600SemiBold",
        "SpaceGrotesk_700Bold",
      ].sort(),
    );
  });

  it("every typeface a text kind can reference is a loaded face", () => {
    for (const [role, face] of Object.entries(typeface)) {
      // A face that is not in fontAssets silently falls back to the system font.
      expect({ role, loaded: face in fontAssets }).toEqual({ role, loaded: true });
    }
  });

  it("covers each family the tokens promise", () => {
    expect(typeface.display.startsWith(fonts.display.replace(/\s/g, ""))).toBe(true);
    expect(typeface.sans.startsWith(fonts.sans.replace(/\s/g, ""))).toBe(true);
    expect(typeface.mono.startsWith(fonts.mono.replace(/\s/g, ""))).toBe(true);
  });
});
