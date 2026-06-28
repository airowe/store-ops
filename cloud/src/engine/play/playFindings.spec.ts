import { describe, expect, it } from "vitest";
import type { FamilyShotScore } from "../screenshotScore.js";
import type { NormalizedListing } from "../store/types.js";
import { playFindings, playSurfaceLocks } from "./playFindings.js";

function listing(over: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    store: "googleplay",
    appId: "com.x",
    title: "Calm",
    tagline: null,
    keywordField: null,
    longDescription: "A".repeat(1000),
    screenshots: [],
    category: null,
    reliable: false,
    ...over,
  };
}

function shot(over: Partial<FamilyShotScore> = {}): FamilyShotScore {
  return {
    app: "x",
    primaryFamily: "phone",
    primaryCount: 6,
    families: [],
    score: 90,
    grade: "A",
    findings: [],
    aspectHint: "",
    ...over,
  };
}

const ids = (fs: { id: string }[]) => fs.map((f) => f.id);

describe("playFindings — long description (the indexed keyword surface)", () => {
  it("a MEASURED-empty description is a critical finding", () => {
    const fs = playFindings({ listing: listing({ longDescription: "" }) });
    expect(ids(fs)).toContain("play_description_empty");
    expect(fs.find((f) => f.id === "play_description_empty")?.severity).toBe("critical");
  });

  it("an UNMEASURED (null) description is NOT a deficiency finding (it's a lock)", () => {
    const fs = playFindings({ listing: listing({ longDescription: null }) });
    expect(ids(fs)).not.toContain("play_description_empty");
    expect(ids(fs)).not.toContain("play_description_thin");
  });

  it("a thin (<500 char) description warns about under-using the surface", () => {
    const fs = playFindings({ listing: listing({ longDescription: "short copy" }) });
    const f = fs.find((x) => x.id === "play_description_thin");
    expect(f?.severity).toBe("warn");
    expect(f?.evidence).toContain("/4000");
  });

  it("a full description emits no description finding", () => {
    expect(ids(playFindings({ listing: listing() }))).not.toContain("play_description_thin");
  });
});

describe("playFindings — title + short description honesty (null ≠ empty)", () => {
  it("measured-empty title → critical; null title → only an info read-note", () => {
    expect(ids(playFindings({ listing: listing({ title: "" }) }))).toContain("play_title_missing");
    const nullTitle = playFindings({ listing: listing({ title: null }) });
    expect(ids(nullTitle)).toContain("play_title_unread");
    expect(ids(nullTitle)).not.toContain("play_title_missing");
  });

  it("measured-empty short description → warn; null short description → nothing", () => {
    expect(ids(playFindings({ listing: listing({ tagline: "" }) }))).toContain(
      "play_short_description_missing",
    );
    expect(ids(playFindings({ listing: listing({ tagline: null }) }))).not.toContain(
      "play_short_description_missing",
    );
  });
});

describe("playFindings — screenshots via the device-family score", () => {
  it("grade F → critical conversion finding", () => {
    const fs = playFindings({ listing: listing(), screenshots: shot({ grade: "F", score: 5 }) });
    expect(fs.find((f) => f.id === "play_screenshots_grade_low")?.severity).toBe("critical");
  });

  it("unknown grade '?' → honest info, never a false F", () => {
    const fs = playFindings({ listing: listing(), screenshots: shot({ grade: "?", score: null }) });
    expect(ids(fs)).toContain("play_screenshots_unknown");
    expect(ids(fs)).not.toContain("play_screenshots_grade_low");
  });

  it("1–3 phone shots → thin warning", () => {
    const fs = playFindings({ listing: listing(), screenshots: shot({ grade: "C", primaryCount: 2 }) });
    expect(fs.find((f) => f.id === "play_screenshots_thin")?.severity).toBe("warn");
  });
});

describe("playFindings — keyword surface (stuffing + gaps), no keyword field", () => {
  it("stuffed terms → a stuffing-risk warning with the terms as evidence", () => {
    const fs = playFindings({
      listing: listing(),
      keywords: { terms: [], missingFromDescription: [], uncovered: [], stuffed: ["meditation"] },
    });
    const f = fs.find((x) => x.id === "play_keyword_stuffing");
    expect(f?.severity).toBe("warn");
    expect(f?.evidence).toBe("meditation");
  });

  it("targets missing from the long description → an info gap finding", () => {
    const fs = playFindings({
      listing: listing(),
      keywords: {
        terms: [],
        missingFromDescription: ["anxiety", "focus"],
        uncovered: [],
        stuffed: [],
      },
    });
    const f = fs.find((x) => x.id === "play_keyword_gaps");
    expect(f?.title).toContain("2 target terms");
  });
});

describe("playFindings — sorting + graceful degradation", () => {
  it("sorts critical findings ahead of warn/info", () => {
    const fs = playFindings({
      listing: listing({ longDescription: "" }), // critical
      screenshots: shot({ grade: "C", primaryCount: 2 }), // warn
    });
    expect(fs[0]?.severity).toBe("critical");
  });

  it("a bare listing with no models never throws and emits at most context", () => {
    expect(() => playFindings({ listing: listing() })).not.toThrow();
  });
});

describe("playSurfaceLocks — capability gaps, never deficiencies (#61)", () => {
  it("a public (unreliable) read locks the unreadable surfaces", () => {
    const locks = playSurfaceLocks(listing({ tagline: null, longDescription: null }));
    const surfaces = locks.map((l) => l.surface);
    expect(surfaces).toContain("shortDescription");
    expect(surfaces).toContain("description");
    expect(surfaces).toContain("screenshots");
    // copy frames a capability gap + opportunity, never a deficiency
    for (const l of locks) {
      expect(l.label.toLowerCase()).toContain("can't see");
      expect(l.unlockCopy.toLowerCase()).toContain("connect");
    }
  });

  it("a connected (reliable) read locks NOTHING", () => {
    expect(playSurfaceLocks(listing({ reliable: true }))).toEqual([]);
  });
});
