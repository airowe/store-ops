/**
 * Fleet aggregation — turns per-app rank/delta data into the dashboard's
 * portfolio surfaces (movers list, chart series). Pure and honest: only MEASURED
 * deltas become movers (a null/unmeasured delta is never a "0" mover), and the
 * list is ranked by the size of the real movement so the biggest changes lead.
 */
import type { AppListItem, DeltaEntry, RankPoint } from "@shipaso/api";

export type Mover = {
  keyword: string;
  app: string;
  delta: number;
  /** 0..1 bar width relative to the biggest absolute move in the set. */
  magnitude: number;
};

/** Per-app deltas keyed by app id, as fetched across the fleet. */
export type FleetDeltas = { app: AppListItem; entries: DeltaEntry[] }[];

/**
 * The top keyword movers across the fleet, biggest absolute move first. Only
 * measured, non-zero deltas qualify. `limit` caps the list (default 5).
 */
export function movers(fleet: FleetDeltas, limit = 5): Mover[] {
  const flat: { keyword: string; app: string; delta: number }[] = [];
  for (const { app, entries } of fleet) {
    for (const e of entries) {
      if (typeof e.delta === "number" && e.delta !== 0) {
        flat.push({ keyword: e.keyword, app: app.name, delta: e.delta });
      }
    }
  }
  flat.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top = flat.slice(0, limit);
  const biggest = top.length ? Math.abs(top[0]!.delta) : 1;
  return top.map((m) => ({ ...m, magnitude: Math.abs(m.delta) / biggest }));
}

/** Per-app rank series keyed by app, as fetched across the fleet. */
export type FleetRanks = { app: AppListItem; points: RankPoint[] }[];

/** Chart series (label + measured ranks) for each app that has any points. */
export function series(fleet: FleetRanks): { label: string; points: (number | null)[] }[] {
  return fleet
    .filter((f) => f.points.length > 0)
    .map((f) => ({ label: f.app.name, points: f.points.map((p) => p.rank) }));
}
