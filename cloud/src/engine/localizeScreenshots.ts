/**
 * Screenshot localization v1-A — "re-caption a layered source" (#78 item 3, PRD
 * docs/prd/visual-assets/04-screenshot-localization.md).
 *
 * The dependency-free first cut: given a layered source (named text slots over a
 * background the user already designed), translate each slot's caption via the
 * existing `Localizer` seam and run a DETERMINISTIC fit analysis per locale so
 * the reviewer sees exactly which captions will overflow their box before
 * anything is shipped. This module is the ASO/localization + typesetting BRAIN;
 * it does NOT rasterize pixels (a Worker has no font renderer) — the same way
 * `screenshotBrief` produces a plan, not an image. Rasterization is the
 * downstream fastlane/renderer step that consumes this manifest.
 *
 * HONESTY RULES (each is a test):
 *   • brand tokens survive translation VERBATIM (placeholder swap + restore),
 *   • NO SILENT CLIPPING — a caption that won't fit is flagged `overflow` with
 *     `needsReview`, never quietly truncated; the fit is an ESTIMATE (heuristic
 *     glyph metrics, not real font shaping) and is labeled as such,
 *   • EXCLUDED locales are stated, never rendered broken — RTL scripts we don't
 *     lay out yet are returned as `excluded` with a reason, not a mangled plan,
 *   • every plan carries the verbatim machine-translated draft caveat,
 *   • a provider failure refuses the WHOLE locale (throws), never a half-plan
 *     with source text posing as a translation.
 */
import { DRAFT_LABEL, LocalizeError, type Localizer } from "./localizeCopy.js";

/** One editable caption region over the (user-supplied) background art. */
export type TextSlot = {
  id: string;
  text: string; // the source (en) caption
  /** the box the caption must fit within, in the same px units as fontSize. */
  box: { width: number; height: number };
  fontSize: number;
  /** smallest size auto-fit may shrink to before declaring overflow (default 70%). */
  minFontSize?: number;
  /** hard cap on wrapped lines (default: as many as the box height allows). */
  maxLines?: number;
  /** line box as a multiple of fontSize (default 1.2). */
  lineHeight?: number;
};

export type LayeredSource = { slots: TextSlot[] };

export type FitAction = "fit" | "shrunk" | "overflow";

export type SlotFit = {
  /** the size the caption is laid out at (≤ the slot's fontSize after shrink). */
  fontSize: number;
  lines: number;
  action: FitAction;
  /** honest note when the reviewer must look (shrunk hard / overflows). */
  note?: string;
};

export type LocalizedSlot = { id: string; text: string; fit: SlotFit };

export type LocalizedScreenshot = {
  locale: string;
  slots: LocalizedSlot[];
  label: typeof DRAFT_LABEL;
  /** true if ANY slot overflows or was shrunk to its floor — surfaces in the UI. */
  needsReview: boolean;
};

export type ExcludedLocale = { locale: string; reason: string };

export type ScreenshotLocalizationResult = {
  localized: LocalizedScreenshot[];
  excluded: ExcludedLocale[];
};

/** RTL scripts we do NOT lay out in v1-A — excluded honestly, never rendered
 *  broken (the PRD's hard rule). Matched on the language subtag. */
const RTL_LANGS = new Set(["ar", "he", "iw", "fa", "ur", "ps", "sd", "ug", "yi", "dv"]);

function isRtl(locale: string): boolean {
  const lang = locale.toLowerCase().split(/[-_]/)[0] ?? "";
  return RTL_LANGS.has(lang);
}

/** CJK captions advance ~1 full em per glyph; Latin/Cyrillic ~0.52. A coarse but
 *  honest estimate — the result is flagged as an estimate, never a guarantee. */
function avgGlyphRatio(locale: string): number {
  const lang = locale.toLowerCase().split(/[-_]/)[0] ?? "";
  return lang === "ja" || lang === "ko" || lang === "zh" ? 1.0 : 0.52;
}

const DEFAULT_LINE_HEIGHT = 1.2;

/** Wrap `text` to a column `charsPerLine` wide. CJK wraps per character (no
 *  spaces); everything else greedily by word. Returns the line count. */
function countWrappedLines(text: string, charsPerLine: number, perChar: boolean): number {
  const t = text.trim();
  if (t === "") return 0;
  if (charsPerLine < 1) charsPerLine = 1;
  if (perChar) return Math.max(1, Math.ceil([...t].length / charsPerLine));

  let lines = 1;
  let col = 0;
  for (const word of t.split(/\s+/)) {
    const w = word.length;
    if (col === 0) {
      col = w;
    } else if (col + 1 + w <= charsPerLine) {
      col += 1 + w;
    } else {
      lines += 1;
      col = w;
    }
    // a single word longer than the column spills onto extra lines
    if (w > charsPerLine) {
      lines += Math.floor((w - 1) / charsPerLine);
      col = w % charsPerLine || charsPerLine;
    }
  }
  return lines;
}

/**
 * Deterministic auto-fit: try the slot's fontSize; if the caption overflows the
 * box (too many lines / too tall), shrink toward `minFontSize`. Report whether
 * it fit outright, fit after shrinking, or still overflows — NEVER truncate.
 */
export function fitCaption(slot: TextSlot, text: string, locale: string): SlotFit {
  const ratio = avgGlyphRatio(locale);
  const lineHeight = slot.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const perChar = ratio >= 1;
  const minSize = slot.minFontSize ?? Math.max(1, Math.round(slot.fontSize * 0.7));

  const evaluate = (size: number): { lines: number; fits: boolean } => {
    const charsPerLine = Math.max(1, Math.floor(slot.box.width / (size * ratio)));
    const lines = countWrappedLines(text, charsPerLine, perChar);
    const maxLinesByHeight = Math.max(1, Math.floor(slot.box.height / (size * lineHeight)));
    const maxLines = slot.maxLines ? Math.min(slot.maxLines, maxLinesByHeight) : maxLinesByHeight;
    return { lines, fits: lines <= maxLines };
  };

  const atFull = evaluate(slot.fontSize);
  if (atFull.fits) return { fontSize: slot.fontSize, lines: atFull.lines, action: "fit" };

  // shrink in whole-px steps down to the floor
  for (let size = slot.fontSize - 1; size >= minSize; size--) {
    const r = evaluate(size);
    if (r.fits) {
      return {
        fontSize: size,
        lines: r.lines,
        action: "shrunk",
        note: `shrunk to ${size}px to fit — review legibility`,
      };
    }
  }
  const floor = evaluate(minSize);
  return {
    fontSize: minSize,
    lines: floor.lines,
    action: "overflow",
    note: "caption overflows its box even at the minimum size — shorten it or enlarge the box",
  };
}

/** Swap brand tokens for placeholders the model preserves, then restore casing. */
function maskBrand(text: string, tokens: string[]): string {
  let out = text;
  tokens.forEach((t, i) => {
    if (!t) return;
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "gi"), `⟦${i}⟧`);
  });
  return out;
}
function unmaskBrand(text: string, tokens: string[]): string {
  let out = text;
  tokens.forEach((t, i) => {
    out = out.split(`⟦${i}⟧`).join(t);
  });
  return out;
}

export type ScreenshotLocalizeInput = {
  source: LayeredSource;
  targetLocales: string[];
  /** brand token(s) that must survive verbatim, e.g. ["Mangia"]. */
  brandTokens: string[];
};

/**
 * Localize a layered screenshot source into per-locale caption plans. RTL target
 * locales are returned in `excluded` (stated, not rendered broken). A provider
 * failure on any slot refuses that whole locale (throws LocalizeError) — no
 * partial plans, no source text as a fake translation.
 */
export async function localizeScreenshots(
  localizer: Localizer,
  input: ScreenshotLocalizeInput,
): Promise<ScreenshotLocalizationResult> {
  const tokens = input.brandTokens.map((t) => t.trim()).filter(Boolean);
  const localized: LocalizedScreenshot[] = [];
  const excluded: ExcludedLocale[] = [];

  for (const locale of input.targetLocales) {
    if (isRtl(locale)) {
      excluded.push({
        locale,
        reason: "right-to-left layout isn't supported yet — not rendered rather than rendered broken",
      });
      continue;
    }

    const slots: LocalizedSlot[] = [];
    for (const slot of input.source.slots) {
      let translated: string;
      if (slot.text.trim() === "") {
        translated = ""; // empty stays empty; never invent caption copy
      } else {
        const masked = maskBrand(slot.text, tokens);
        let out: string;
        try {
          // screenshot captions are promotional marketing copy → "promo" kind.
          out = await localizer({ text: masked, targetLocale: locale, kind: "promo" });
        } catch (e) {
          throw new LocalizeError(
            `translation failed for slot "${slot.id}" (${e instanceof Error ? e.message : "provider error"})`,
          );
        }
        translated = unmaskBrand(out.trim(), tokens);
      }
      slots.push({ id: slot.id, text: translated, fit: fitCaption(slot, translated, locale) });
    }

    localized.push({
      locale,
      slots,
      label: DRAFT_LABEL,
      needsReview: slots.some((s) => s.fit.action !== "fit"),
    });
  }

  return { localized, excluded };
}

/**
 * Flatten the result into a renderer/fastlane-ready manifest: per locale, the
 * final caption text + laid-out font size per slot. Excluded locales are omitted
 * (the caller already has them in `result.excluded` to surface honestly).
 */
export function toScreenshotManifest(
  result: ScreenshotLocalizationResult,
): Record<string, Record<string, { text: string; fontSize: number }>> {
  const out: Record<string, Record<string, { text: string; fontSize: number }>> = {};
  for (const shot of result.localized) {
    const perSlot: Record<string, { text: string; fontSize: number }> = {};
    for (const s of shot.slots) perSlot[s.id] = { text: s.text, fontSize: s.fit.fontSize };
    out[shot.locale] = perSlot;
  }
  return out;
}
