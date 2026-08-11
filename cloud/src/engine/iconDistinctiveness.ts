/**
 * Icon distinctiveness (#455) — does your icon read as the SAME KIND OF OBJECT
 * as the other icons on a results page, or as a different one?
 *
 * The finding this exists to make: in a category where nine of the top ten icons
 * are one big centred shape on a flat field, the tenth reads as a different
 * category of object at thumbnail size. That is a real conversion lever and it is
 * invisible from metadata alone — nothing else in the audit looks at artwork.
 *
 * Honesty, load-bearing (the same shape as captionLens.ts):
 *   • the composition of each icon is MEASURED (from the app's real artwork, via
 *     an injected analyzer) — never inferred from the category or guessed,
 *   • "conforms" vs "stands apart" is a HEURISTIC over those measurements,
 *     labelled as one; we do NOT claim either is better. Distinctiveness cuts
 *     both ways and the finding says so,
 *   • measured-or-absent: too few neighbours read, no read of YOUR icon, or a
 *     neighbour set with no clear convention emits NOTHING — never a fake flag.
 *
 * Pure + deterministic: no fetch / Date.now / randomness. The artwork reads are
 * INJECTED (an IconAnalyzer, env.AI-backed in the API adapter), so this module is
 * unit-testable with a fake analyzer.
 */
import type { Finding } from "./findings/core.js";

/**
 * One icon's composition, as measured from its artwork.
 *
 * Deliberately coarse: these are the traits that survive being shrunk to a 60px
 * search-results thumbnail. A finer read (exact hue, corner radius) would be
 * precision we cannot defend at that size.
 */
export type IconComposition = {
  /** one dominant centred form vs. a repeated/scattered/edge-to-edge layout. */
  layout: "single_centred_shape" | "other";
  /** does the artwork carry legible text/wordmark at thumbnail size? */
  hasText: boolean;
};

/** One measured icon: which app it belongs to, and what its artwork looks like. */
export type IconRead = {
  /** App Store track id — the stable key, never a display name. */
  appId: string;
  composition: IconComposition;
};

/** Reads one icon's composition from its artwork URL. Returns null on any failure. */
export type IconAnalyzer = (artworkUrl: string) => Promise<IconComposition | null>;

/**
 * The minimum neighbour set worth calling a "convention". Below this, a majority
 * is an accident of a small sample, not a pattern — so we stay silent instead of
 * dressing up noise as a finding.
 */
export const MIN_NEIGHBOURS = 5;

/**
 * How much of the neighbour set must share a layout before we call it the
 * category convention. 0.7 = at least 7 of 10; a bare majority is not a norm.
 */
export const CONVENTION_THRESHOLD = 0.7;

const HEURISTIC =
  "Flagged as a heuristic over measured artwork — not a verdict, and not a claim that either choice converts better.";

/**
 * At most one finding, from YOUR measured icon against MEASURED neighbours.
 *
 * Emits nothing (measured-or-absent) when:
 *   • your icon was not read,
 *   • fewer than MIN_NEIGHBOURS neighbours were read,
 *   • the neighbour set has no convention at CONVENTION_THRESHOLD.
 *
 * When a convention exists, we report which side of it you are on — conforming
 * and standing apart are both reported, because neither is inherently right.
 */
export function iconDistinctivenessFindings(
  mine: IconRead | null,
  neighbours: IconRead[],
): Finding[] {
  if (!mine) return [];
  // Never let the app compare against itself — a duplicate id would bias the vote.
  const others = neighbours.filter((n) => n.appId !== mine.appId);
  if (others.length < MIN_NEIGHBOURS) return [];

  const centred = others.filter(
    (n) => n.composition.layout === "single_centred_shape",
  ).length;
  const share = centred / others.length;
  const conventionIsCentred = share >= CONVENTION_THRESHOLD;
  const conventionIsOther = 1 - share >= CONVENTION_THRESHOLD;
  if (!conventionIsCentred && !conventionIsOther) return [];

  const conventionLayout = conventionIsCentred ? "single_centred_shape" : "other";
  const conforms = mine.composition.layout === conventionLayout;
  const majority = conventionIsCentred ? centred : others.length - centred;
  const norm = conventionIsCentred
    ? "one dominant centred shape"
    : "a layout other than one dominant centred shape";
  const evidence = `${majority} of ${others.length} top competitor icons use ${norm}; yours does not.`;
  const evidenceConforming = `${majority} of ${others.length} top competitor icons use ${norm}; yours does too.`;

  if (conforms) {
    return [
      {
        id: "icon_conforms_to_category",
        surface: "icon",
        severity: "info",
        impact: "conversion",
        title: "Your icon looks like the rest of your category",
        detail: `At thumbnail size your icon shares its composition with most of the top apps in your category — ${majority} of ${others.length} use ${norm}, and so do you. That makes it legible as the right kind of app, and harder to pick out of a row. ${HEURISTIC}`,
        fix: "If you want the icon to be the thing that stops the scroll, change the trait the category shares — the silhouette, not the colour.",
        evidence: evidenceConforming,
      },
    ];
  }

  return [
    {
      id: "icon_stands_apart",
      surface: "icon",
      severity: "info",
      impact: "conversion",
      title: "Your icon does not look like the rest of your category",
      detail: `At thumbnail size ${majority} of ${others.length} top competitor icons use ${norm} and yours does not, so it reads as a different kind of object in a results row. That can be the thing that earns the tap, or it can cost you the instant category read — and the icon then can't say what the app does, so your title has to. ${HEURISTIC}`,
      fix: "Decide this one deliberately: keep the contrast and let the title carry the category, or adopt the shared silhouette and differentiate on colour.",
      evidence,
    },
  ];
}

/**
 * Measure a set of icons, cost-bounded to one inference per app.
 *
 * Safe-degrade throughout: a missing url, an analyzer returning null, or one that
 * throws drops THAT icon from the set rather than failing the batch. A dropped
 * icon shrinks the measured neighbour set, which is what MIN_NEIGHBOURS is for —
 * we would rather emit nothing than compare against a set we could not read.
 */
export async function readIcons(
  analyzer: IconAnalyzer,
  apps: { appId: string; artworkUrl?: string | null | undefined }[],
): Promise<IconRead[]> {
  const out: IconRead[] = [];
  for (const app of apps) {
    if (!app.artworkUrl) continue;
    let composition: IconComposition | null = null;
    try {
      composition = await analyzer(app.artworkUrl);
    } catch {
      composition = null; // an unreadable icon is unmeasured, never a default
    }
    if (composition) out.push({ appId: app.appId, composition });
  }
  return out;
}
