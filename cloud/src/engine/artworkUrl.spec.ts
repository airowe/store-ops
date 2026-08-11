/**
 * `artworkUrlFrom` — the ONE place the icon size-fallback order is defined.
 *
 * Three modules had grown their own copy of "512 else 100 else 60"
 * (iconNeighbours, digestCardSource, and a two-step variant in resolveApp).
 * The order is a real decision — biggest first, because the vision read wants
 * the most detail — and a fourth inline copy is how those drift apart.
 */
import { describe, expect, it } from "vitest";
import { artworkUrlFrom } from "./itunes.js";

describe("artworkUrlFrom", () => {
  it("prefers the 512 when every size is present", () => {
    expect(
      artworkUrlFrom({ artworkUrl512: "big.png", artworkUrl100: "mid.png", artworkUrl60: "sm.png" }),
    ).toBe("big.png");
  });

  it("falls back through the sizes in order", () => {
    expect(artworkUrlFrom({ artworkUrl100: "mid.png", artworkUrl60: "sm.png" })).toBe("mid.png");
    expect(artworkUrlFrom({ artworkUrl60: "sm.png" })).toBe("sm.png");
  });

  it("returns undefined when the result carries no artwork at all", () => {
    expect(artworkUrlFrom({})).toBeUndefined();
  });

  it("treats an EMPTY string as no artwork, not as a url", () => {
    // A blank url passes a truthiness check while failing every actual fetch —
    // an icon we cannot read is unmeasured, so it must be undefined here.
    expect(artworkUrlFrom({ artworkUrl512: "" })).toBeUndefined();
    expect(artworkUrlFrom({ artworkUrl512: "", artworkUrl100: "", artworkUrl60: "" })).toBeUndefined();
  });

  it("skips a blank larger size to reach a real smaller one", () => {
    expect(artworkUrlFrom({ artworkUrl512: "", artworkUrl100: "mid.png" })).toBe("mid.png");
  });

  it("ignores non-string values rather than returning them", () => {
    const junk = { artworkUrl512: 42, artworkUrl100: null, artworkUrl60: "sm.png" };
    expect(artworkUrlFrom(junk as never)).toBe("sm.png");
    expect(artworkUrlFrom({ artworkUrl512: {} } as never)).toBeUndefined();
  });
});
