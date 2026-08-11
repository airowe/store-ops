/**
 * The icon comparison, end to end (#455) — the chain that turns four merged
 * modules into a finding a user actually sees.
 *
 * Each piece landed separately and none of them called each other:
 *   • `iconDistinctiveness` (#466) — the finding, given measured icons,
 *   • `aiIconVision` (#467) — the env.AI analyzer + the inference budget,
 *   • `iconNeighbours` (#468) — who to compare against, and their artwork,
 *   • `audit.artworkUrl` (#470) — our own icon.
 * This is the wiring: chart entries → neighbour ids → neighbour artwork →
 * measure ours + theirs under ONE budget → finding.
 *
 * Cost is the reason this is opt-in and bounded. Every other audit surface is a
 * cheap HTTP read; this one spends an inference PER ICON. `analyzeIconSet`
 * caps the batch, and `iconAnalyzerForEnv` returns undefined unless
 * ICON_VISION_ENABLED is set — so the default run path spends nothing and emits
 * no icon finding at all.
 *
 * Measured-or-absent, inherited rather than re-implemented: an unread icon is
 * dropped by `readIconSet` below, a short neighbour set falls under
 * MIN_NEIGHBOURS, and `iconDistinctivenessFindings` then emits nothing. There is
 * no path here that invents a composition for an icon we could not read.
 */
import type { Finding } from "./findings/core.js";
import {
  type IconAnalyzer,
  type IconRead,
  iconDistinctivenessFindings,
} from "./iconDistinctiveness.js";
import {
  type NeighbourIcon,
  fetchNeighbourIcons,
  neighbourIdsFromChart,
} from "./iconNeighbours.js";
import type { FetchFn } from "./itunes.js";

/** One app to measure: its id and the artwork to read. */
export type IconTarget = { appId: string; artworkUrl: string };

/**
 * Measure a set of icons through a BUDGETED batch reader.
 *
 * Takes the batch analyzer (`analyzeIconSet` from the API adapter) rather than a
 * per-icon `IconAnalyzer`, so the whole comparison — ours plus every neighbour —
 * shares ONE inference budget. `readIcons` in the engine deliberately has no cap;
 * spending policy lives with the adapter that spends the money.
 *
 * An icon the batch could not read comes back null and is DROPPED, which shrinks
 * the measured set rather than defaulting it to a composition.
 */
export async function readIconSet(
  batch: (urls: string[]) => Promise<(IconRead["composition"] | null)[]>,
  targets: IconTarget[],
): Promise<IconRead[]> {
  if (targets.length === 0) return [];
  const compositions = await batch(targets.map((t) => t.artworkUrl));
  const out: IconRead[] = [];
  for (const [i, target] of targets.entries()) {
    const composition = compositions[i];
    if (composition) out.push({ appId: target.appId, composition });
  }
  return out;
}

/** What the comparison needs about the app being audited. */
export type IconComparisonInput = {
  /** our App Store track id — the key the neighbour set excludes. */
  appId: string;
  /** our icon artwork, from `audit.artworkUrl` (#470). Absent ⇒ no comparison. */
  artworkUrl?: string | undefined;
  /** the ordered chart ids for our category, from the chart feed (#469). */
  chartEntries: string[];
  country: string;
};

/**
 * Run the whole comparison and return at most one finding.
 *
 * Ordering matters for cost: OUR icon goes first in the batch, so a budget that
 * runs out truncates neighbours (which only shrinks the comparison set) rather
 * than dropping the one icon the finding cannot work without.
 *
 * Returns [] — never throws — when the chain cannot produce a measured answer:
 * no icon of ours, no chart entries, no readable neighbour artwork, or a
 * neighbour set too small or too mixed to call a convention.
 */
export async function iconComparisonFindings(
  fetchFn: FetchFn,
  batch: (urls: string[]) => Promise<(IconRead["composition"] | null)[]>,
  input: IconComparisonInput,
): Promise<Finding[]> {
  if (!input.artworkUrl) return [];
  const neighbourIds = neighbourIdsFromChart(input.chartEntries, input.appId);
  if (neighbourIds.length === 0) return [];

  let neighbourIcons: NeighbourIcon[] = [];
  try {
    neighbourIcons = await fetchNeighbourIcons(fetchFn, neighbourIds, input.country);
  } catch {
    return [];
  }
  if (neighbourIcons.length === 0) return [];

  // One batch, one budget — ours first (see above).
  const targets: IconTarget[] = [
    { appId: input.appId, artworkUrl: input.artworkUrl },
    ...neighbourIcons.map((n) => ({ appId: n.appId, artworkUrl: n.artworkUrl })),
  ];
  let reads: IconRead[] = [];
  try {
    reads = await readIconSet(batch, targets);
  } catch {
    return [];
  }

  const mine = reads.find((r) => r.appId === input.appId) ?? null;
  const neighbours = reads.filter((r) => r.appId !== input.appId);
  return iconDistinctivenessFindings(mine, neighbours);
}

/** Re-exported so callers wire one import. */
export type { IconAnalyzer };
