import { describe, expect, it, vi } from "vitest";
import {
  CONVENTION_THRESHOLD,
  MIN_NEIGHBOURS,
  iconDistinctivenessFindings,
  readIcons,
  type IconComposition,
  type IconRead,
} from "./iconDistinctiveness.js";

const CENTRED: IconComposition = { layout: "single_centred_shape", hasText: false };
const OTHER: IconComposition = { layout: "other", hasText: false };

/** n neighbours, the first `centred` of them using the category's centred shape. */
function neighbours(n: number, centred: number): IconRead[] {
  return Array.from({ length: n }, (_, i) => ({
    appId: `n${i}`,
    composition: i < centred ? CENTRED : OTHER,
  }));
}

describe("iconDistinctivenessFindings", () => {
  it("flags an icon that breaks a clear category convention", () => {
    const out = iconDistinctivenessFindings(
      { appId: "mine", composition: OTHER },
      neighbours(10, 9),
    );
    expect(out).toHaveLength(1);
    const f = out[0]!;
    expect(f.id).toBe("icon_stands_apart");
    expect(f.surface).toBe("icon");
    expect(f.impact).toBe("conversion");
    // the measured counts are quoted, not rounded away
    expect(f.evidence).toBe(
      "9 of 10 top competitor icons use one dominant centred shape; yours does not.",
    );
    // honesty: heuristic, and explicitly not a claim that either side converts better
    expect(f.detail).toMatch(/heuristic/i);
    expect(f.detail).toMatch(/not a claim that either choice converts better/i);
  });

  it("names the trade rather than treating distinctiveness as a win", () => {
    const out = iconDistinctivenessFindings(
      { appId: "mine", composition: OTHER },
      neighbours(10, 9),
    );
    // the honest cost: a distinct icon can't also say what the app does
    expect(out[0]!.detail).toMatch(/title/i);
    expect(out[0]!.fix).toMatch(/deliberately/i);
  });

  it("reports conforming to the convention too (not just breaking it)", () => {
    const out = iconDistinctivenessFindings(
      { appId: "mine", composition: CENTRED },
      neighbours(10, 9),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("icon_conforms_to_category");
    expect(out[0]!.evidence).toMatch(/yours does too/);
  });

  it("detects a convention that runs the OTHER way", () => {
    // 9 of 10 neighbours are NOT centred; a centred icon is the odd one out.
    const out = iconDistinctivenessFindings(
      { appId: "mine", composition: CENTRED },
      neighbours(10, 1),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("icon_stands_apart");
    expect(out[0]!.evidence).toMatch(/a layout other than one dominant centred shape/);
  });

  it("never emits a severity that would read as a fix to make", () => {
    for (const mineComp of [CENTRED, OTHER]) {
      const out = iconDistinctivenessFindings(
        { appId: "mine", composition: mineComp },
        neighbours(10, 9),
      );
      // this is a deliberate design call, not a defect: info, never critical/warn
      expect(out[0]!.severity).toBe("info");
    }
  });

  // ── measured-or-absent: the silence paths ──────────────────────────────────
  it("emits nothing when our own icon was not read", () => {
    expect(iconDistinctivenessFindings(null, neighbours(10, 9))).toEqual([]);
  });

  it("emits nothing when too few neighbours were measured", () => {
    const out = iconDistinctivenessFindings(
      { appId: "mine", composition: OTHER },
      neighbours(MIN_NEIGHBOURS - 1, MIN_NEIGHBOURS - 1),
    );
    expect(out).toEqual([]);
  });

  it("emits nothing when the category has no convention", () => {
    // a 50/50 split is not a norm — calling it one would be inventing a finding
    const out = iconDistinctivenessFindings(
      { appId: "mine", composition: OTHER },
      neighbours(10, 5),
    );
    expect(out).toEqual([]);
  });

  it("stays silent just below the threshold and speaks just above it", () => {
    const mine = { appId: "mine", composition: OTHER };
    const below = Math.floor(CONVENTION_THRESHOLD * 10) - 1; // 6 of 10
    const at = Math.ceil(CONVENTION_THRESHOLD * 10); //         7 of 10
    expect(iconDistinctivenessFindings(mine, neighbours(10, below))).toEqual([]);
    expect(iconDistinctivenessFindings(mine, neighbours(10, at))).toHaveLength(1);
  });

  it("excludes our own app from the neighbour vote", () => {
    // 5 real neighbours + our own id echoed back; the echo must not count toward
    // MIN_NEIGHBOURS, so this is a 5-neighbour set, not a 6-neighbour one.
    const withEcho: IconRead[] = [
      ...neighbours(5, 5),
      { appId: "mine", composition: OTHER },
    ];
    const out = iconDistinctivenessFindings(
      { appId: "mine", composition: OTHER },
      withEcho,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence).toBe(
      "5 of 5 top competitor icons use one dominant centred shape; yours does not.",
    );
  });

  it("emits nothing for an empty neighbour set", () => {
    expect(
      iconDistinctivenessFindings({ appId: "mine", composition: OTHER }, []),
    ).toEqual([]);
  });
});

describe("readIcons", () => {
  it("measures one icon per app and keys each read to its app id", async () => {
    const analyzer = vi.fn(async () => CENTRED);
    const out = await readIcons(analyzer, [
      { appId: "a", artworkUrl: "a.png" },
      { appId: "b", artworkUrl: "b.png" },
    ]);
    expect(out).toEqual([
      { appId: "a", composition: CENTRED },
      { appId: "b", composition: CENTRED },
    ]);
    expect(analyzer).toHaveBeenCalledTimes(2);
  });

  it("skips apps with no artwork url without calling the analyzer", async () => {
    const analyzer = vi.fn(async () => CENTRED);
    const out = await readIcons(analyzer, [
      { appId: "a", artworkUrl: null },
      { appId: "b", artworkUrl: undefined },
      { appId: "c" },
    ]);
    expect(out).toEqual([]);
    expect(analyzer).not.toHaveBeenCalled();
  });

  it("drops an unreadable icon rather than defaulting it", async () => {
    const analyzer = vi.fn(async (url: string) => (url === "bad.png" ? null : CENTRED));
    const out = await readIcons(analyzer, [
      { appId: "a", artworkUrl: "good.png" },
      { appId: "b", artworkUrl: "bad.png" },
    ]);
    expect(out).toEqual([{ appId: "a", composition: CENTRED }]);
  });

  it("survives an analyzer that throws, keeping the rest of the batch", async () => {
    const analyzer = vi.fn(async (url: string) => {
      if (url === "boom.png") throw new Error("network");
      return OTHER;
    });
    const out = await readIcons(analyzer, [
      { appId: "a", artworkUrl: "boom.png" },
      { appId: "b", artworkUrl: "fine.png" },
    ]);
    expect(out).toEqual([{ appId: "b", composition: OTHER }]);
  });

  it("a batch of failures degrades to silence, not to a finding", async () => {
    const analyzer = vi.fn(async () => null);
    const reads = await readIcons(analyzer, [
      { appId: "a", artworkUrl: "a.png" },
      { appId: "b", artworkUrl: "b.png" },
    ]);
    // end to end: unreadable neighbours can never produce a comparison
    expect(iconDistinctivenessFindings({ appId: "mine", composition: OTHER }, reads))
      .toEqual([]);
  });
});
