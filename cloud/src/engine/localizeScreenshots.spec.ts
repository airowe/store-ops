import { describe, expect, it, vi } from "vitest";
import {
  fitCaption,
  localizeScreenshots,
  toScreenshotManifest,
  type LayeredSource,
  type TextSlot,
} from "./localizeScreenshots.js";
import { DRAFT_LABEL, LocalizeError, type Localizer } from "./localizeCopy.js";

const SLOT = (over: Partial<TextSlot> = {}): TextSlot => ({
  id: "headline",
  text: "Plan meals fast",
  box: { width: 300, height: 120 },
  fontSize: 40,
  ...over,
});

/** A localizer that appends the locale and (optionally) inflates length. */
function fakeLocalizer(opts: { expand?: number } = {}): Localizer {
  return async ({ text, targetLocale }) => {
    const base = `${text} (${targetLocale})`;
    return opts.expand ? base + " x".repeat(opts.expand) : base;
  };
}

describe("fitCaption — deterministic auto-fit, never truncates", () => {
  it("fits outright when the caption is short", () => {
    const fit = fitCaption(SLOT(), "Hi", "de-DE");
    expect(fit.action).toBe("fit");
    expect(fit.fontSize).toBe(40);
  });

  it("shrinks (not truncates) a caption that is a bit too big", () => {
    // a long single line at 40px in a 300px box needs to shrink
    const fit = fitCaption(SLOT({ box: { width: 300, height: 60 }, maxLines: 1 }), "Plan your weekly meals now", "en-US");
    expect(["shrunk", "overflow"]).toContain(fit.action);
    expect(fit.fontSize).toBeLessThanOrEqual(40);
  });

  it("flags overflow (never clips) when it can't fit even at the floor", () => {
    const fit = fitCaption(SLOT({ box: { width: 60, height: 30 }, maxLines: 1 }), "A very very long uncuttable caption", "en-US");
    expect(fit.action).toBe("overflow");
    expect(fit.note).toMatch(/overflows/);
  });

  it("CJK wraps per character (denser), still deterministic", () => {
    const a = fitCaption(SLOT(), "毎週の食事を計画", "ja");
    const b = fitCaption(SLOT(), "毎週の食事を計画", "ja");
    expect(a).toEqual(b); // deterministic
  });
});

describe("localizeScreenshots — per-locale caption plans", () => {
  it("translates each slot, preserves the brand, carries the draft label", async () => {
    const source: LayeredSource = { slots: [SLOT({ text: "Mangia plans your meals" })] };
    const res = await localizeScreenshots(fakeLocalizer(), {
      source,
      targetLocales: ["de-DE"],
      brandTokens: ["Mangia"],
    });
    expect(res.localized).toHaveLength(1);
    const shot = res.localized[0]!;
    expect(shot.label).toBe(DRAFT_LABEL);
    expect(shot.slots[0]!.text).toContain("Mangia"); // brand survived verbatim
    expect(shot.slots[0]!.text).toContain("(de-DE)");
  });

  it("excludes RTL locales honestly instead of rendering them broken", async () => {
    const res = await localizeScreenshots(fakeLocalizer(), {
      source: { slots: [SLOT()] },
      targetLocales: ["ar", "he", "de-DE"],
      brandTokens: [],
    });
    expect(res.localized.map((l) => l.locale)).toEqual(["de-DE"]);
    expect(res.excluded.map((e) => e.locale).sort()).toEqual(["ar", "he"]);
    expect(res.excluded[0]!.reason).toMatch(/right-to-left/i);
  });

  it("needsReview flips when a translation overflows its box", async () => {
    const source: LayeredSource = { slots: [SLOT({ box: { width: 120, height: 44 }, maxLines: 1 })] };
    const res = await localizeScreenshots(fakeLocalizer({ expand: 40 }), {
      source,
      targetLocales: ["de-DE"],
      brandTokens: [],
    });
    expect(res.localized[0]!.needsReview).toBe(true);
    expect(res.localized[0]!.slots[0]!.fit.action).toBe("overflow");
  });

  it("an empty slot stays empty — never invents caption copy", async () => {
    const res = await localizeScreenshots(fakeLocalizer(), {
      source: { slots: [SLOT({ id: "blank", text: "   " })] },
      targetLocales: ["de-DE"],
      brandTokens: [],
    });
    expect(res.localized[0]!.slots[0]!.text).toBe("");
  });

  it("a provider failure refuses the whole locale (no half-plan)", async () => {
    const boom: Localizer = vi.fn(async () => {
      throw new Error("provider down");
    });
    await expect(
      localizeScreenshots(boom, { source: { slots: [SLOT()] }, targetLocales: ["de-DE"], brandTokens: [] }),
    ).rejects.toBeInstanceOf(LocalizeError);
  });
});

describe("toScreenshotManifest", () => {
  it("flattens to locale → slot → {text, fontSize}, omitting excluded locales", async () => {
    const res = await localizeScreenshots(fakeLocalizer(), {
      source: { slots: [SLOT({ id: "headline", text: "Fast" })] },
      targetLocales: ["de-DE", "ar"],
      brandTokens: [],
    });
    const manifest = toScreenshotManifest(res);
    expect(Object.keys(manifest)).toEqual(["de-DE"]); // ar excluded, omitted
    expect(manifest["de-DE"]!.headline!.text).toContain("(de-DE)");
    expect(typeof manifest["de-DE"]!.headline!.fontSize).toBe("number");
  });
});
