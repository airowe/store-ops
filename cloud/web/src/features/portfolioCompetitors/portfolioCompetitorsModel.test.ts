/**
 * The /competitors derivations (#356). These are the numbers and labels the
 * screen is allowed to state, so they are proved here without a DOM:
 * counts come off the pairs received, a rival is never flattened to one status,
 * and a source is never renamed into one it didn't come from.
 */
import { describe, it, expect } from "vitest";
import type { PortfolioRival, PortfolioRivalPair } from "@shipaso/api";
import {
  confirmedPairs,
  initial,
  isWatched,
  rivalMeta,
  sourceLabel,
  suggestions,
  watchedSummary,
} from "./portfolioCompetitorsModel.js";

const pair = (app: string, status: string, source = "similar"): PortfolioRivalPair => ({
  app_id: `id-${app}`,
  app_name: app,
  status,
  source,
});

const rival = (key: string, pairs: PortfolioRivalPair[]): PortfolioRival => ({
  key,
  name: `Rival ${key}`,
  pairs,
});

describe("portfolioCompetitorsModel", () => {
  it.each([
    { pairs: [pair("A", "confirmed")], watched: true },
    { pairs: [pair("A", "suggested")], watched: false },
    { pairs: [pair("A", "suggested"), pair("B", "confirmed")], watched: true },
    { pairs: [pair("A", "suggested"), pair("B", "suggested")], watched: false },
  ])("watched = confirmed on at least one app ($watched)", ({ pairs, watched }) => {
    expect(isWatched(rival("r", pairs))).toBe(watched);
  });

  it.each([
    { pairs: [pair("A", "confirmed"), pair("B", "confirmed"), pair("C", "suggested")], meta: "overlaps 3 of your apps · watched on 2" },
    // "your apps" names the SET, so it stays plural at any count — "1 of your
    // app" is not English.
    { pairs: [pair("A", "confirmed")], meta: "overlaps 1 of your apps · watched on 1" },
    { pairs: [pair("A", "suggested"), pair("B", "suggested")], meta: "overlaps 2 of your apps · watched on 0" },
  ])("meta counts both numbers off the pairs: $meta", ({ pairs, meta }) => {
    expect(rivalMeta(rival("r", pairs))).toBe(meta);
  });

  it("summary counts rivals and their CONFIRMED pairs only", () => {
    const watched = [
      rival("a", [pair("A", "confirmed"), pair("B", "confirmed"), pair("C", "suggested")]),
      rival("b", [pair("A", "confirmed")]),
    ];
    expect(watchedSummary(watched)).toBe("2 rivals · 3 app pairs");
    expect(watchedSummary([])).toBe("0 rivals · 0 app pairs");
    expect(confirmedPairs(watched[0]!)).toHaveLength(2);
  });

  it("suggestions are flat per rival x app, and exclude rivals watched anywhere", () => {
    const mixed = rival("mixed", [pair("A", "confirmed"), pair("B", "suggested")]);
    const cold = rival("cold", [pair("A", "suggested"), pair("B", "suggested")]);
    const out = suggestions([mixed, cold]);
    // mixed's unconfirmed pair stays inside its own card, not in the grid
    expect(out.map((s) => `${s.rival.key}:${s.pair.app_name}`)).toEqual(["cold:A", "cold:B"]);
  });

  it.each([
    { source: "similar", label: "from Apple’s similar apps" },
    { source: "keywords", label: "from your tracked keywords" },
    { source: "user", label: "added by you" },
  ])("names the source $source honestly", ({ source, label }) => {
    expect(sourceLabel(source)).toBe(label);
  });

  it("reports an unrecognised source verbatim rather than inventing one", () => {
    expect(sourceLabel("manual-import")).toBe("from manual-import");
  });

  it.each([
    { name: "MacroTrack", want: "M" },
    { name: "  lift log", want: "L" },
    { name: "", want: "?" },
  ])("initial of $name", ({ name, want }) => {
    expect(initial(name)).toBe(want);
  });
});
