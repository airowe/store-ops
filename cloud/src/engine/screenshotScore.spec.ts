import { describe, expect, it } from "vitest";
import {
  aspectFromUrl,
  aspectLabel,
  gradeFor,
  resolveShotUrl,
  score,
  scoreScreenshotGroups,
  shotLevers,
  type Lever,
  type Listing,
} from "./screenshotScore.js";
import { APP_STORE_PROFILE, GOOGLE_PLAY_PROFILE } from "./store/profiles.js";

const TALL = "https://is1.mzstatic.com/image/thumb/x/v4/a/b/c/1290x2796bb.png";
const WIDE = "https://is1.mzstatic.com/image/thumb/x/v4/a/b/c/392x696bb.png";

// The iTunes/ASC APIs return the trailing size token as an UNSUBSTITUTED
// template, e.g. ".../iphone-6.5_05.png/{w}x{h}bb.{f}". Sent to <img> as-is,
// the browser percent-encodes the braces and Apple's CDN 404s — every shot
// renders broken. resolveShotUrl must substitute the tokens with real values.
const TEMPLATED =
  "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/a/b/c/iphone-6.5_05_whatcanImake.png/{w}x{h}bb.{f}";

function listing(nIphone = 0, nIpad = 0, url = TALL): Listing {
  return {
    screenshotUrls: Array.from({ length: nIphone }, () => url),
    ipadScreenshotUrls: Array.from({ length: nIpad }, () => "ipad"),
  };
}

describe("aspect parsing", () => {
  it("reads the size token from the URL", () => {
    expect(aspectFromUrl(TALL)).toEqual([1290, 2796]);
    expect(aspectFromUrl(WIDE)).toEqual([392, 696]);
  });

  it("returns null when there is no size token", () => {
    expect(aspectFromUrl("https://x/no-size-here.png")).toBeNull();
  });

  it("reads dims from a resolved (previously templated) URL", () => {
    // The whole point of resolveShotUrl: aspect detection works afterwards.
    expect(aspectFromUrl(resolveShotUrl(TEMPLATED))).not.toBeNull();
  });
});

describe("resolveShotUrl (mzstatic template substitution)", () => {
  it("substitutes {w}/{h}/{f} with real values", () => {
    const out = resolveShotUrl(TEMPLATED);
    expect(out).not.toContain("{w}");
    expect(out).not.toContain("{h}");
    expect(out).not.toContain("{f}");
    expect(out).not.toContain("%7B"); // no encoded brace survives
    // ends in a real, loadable size token
    expect(out).toMatch(/\/\d{2,4}x\d{2,4}bb\.(png|jpg)$/);
  });

  it("preserves the native dimensions so aspect scoring stays correct", () => {
    const dims = aspectFromUrl(resolveShotUrl(TEMPLATED));
    expect(dims).not.toBeNull();
    const [w, h] = dims as [number, number];
    expect(h / w).toBeGreaterThanOrEqual(2.0); // tall-phone ratio recovered
  });

  it("leaves an already-resolved URL untouched (idempotent)", () => {
    expect(resolveShotUrl(TALL)).toBe(TALL);
    expect(resolveShotUrl(WIDE)).toBe(WIDE);
  });

  it("handles the {c} crop token if Apple includes it", () => {
    const withCrop = TEMPLATED.replace("bb.{f}", "{c}.{f}");
    const out = resolveShotUrl(withCrop);
    expect(out).not.toContain("{c}");
    expect(out).not.toContain("{f}");
  });

  it("labels a tall phone ratio", () => {
    expect(aspectLabel(1290, 2796)).toContain("tall phone");
  });
});

describe("screenshot grading", () => {
  it("grades an empty set F", () => {
    const res = score("x", listing(0));
    expect(res.grade).toBe("F");
    expect(res.iphoneCount).toBe(0);
    expect(res.findings.some((f) => f.includes("No iPhone screenshots"))).toBe(true);
  });

  it("flags a thin set and scores it below a fuller set", () => {
    const few = score("x", listing(2));
    expect(few.findings.some((f) => f.includes("Only 2"))).toBe(true);
    expect(few.score!).toBeLessThan(score("x", listing(6)).score!);
  });

  it("grades a full set well (A or B, >=70)", () => {
    const res = score("x", listing(8, 4));
    expect(res.score).toBeGreaterThanOrEqual(70);
    expect(["A", "B"]).toContain(res.grade);
  });

  it("awards points for an iPad set", () => {
    expect(score("x", listing(6, 5)).score!).toBeGreaterThan(score("x", listing(6, 0)).score!);
  });

  it("scores a tall ratio higher than a wide one", () => {
    expect(score("x", listing(6, 0, TALL)).score!).toBeGreaterThan(
      score("x", listing(6, 0, WIDE)).score!,
    );
  });

  it("caps the score at 100", () => {
    expect(score("x", listing(10, 10, TALL)).score!).toBeLessThanOrEqual(100);
  });

  it.each([
    [0, "F"],
    [10, "A"],
  ])("count=%i yields grade %s for a tall iPad-backed set", (n, grade) => {
    const res = score("x", listing(n, n, TALL));
    expect(res.grade).toBe(grade);
  });
});

// #41: the public iTunes API cannot reliably report screenshots — an empty set
// from it means UNKNOWN, not zero. We must never assert "grade F / can't convert"
// off data that can't see the screenshots.
describe("screenshot grading — unreadable data is unknown, not zero (#41)", () => {
  it("grades an empty set from unreliable data as UNKNOWN, not F", () => {
    const res = score("x", { screenshotUrls: [], ipadScreenshotUrls: [], dataReliable: false });
    expect(res.grade).toBe("?");
    expect(res.score).toBeNull();
    // Honest finding — no "can't convert", no "No iPhone screenshots".
    expect(res.findings.some((f) => /No iPhone screenshots/.test(f))).toBe(false);
    expect(res.findings.some((f) => /can't convert/.test(f))).toBe(false);
    expect(res.findings.some((f) => /couldn't read|App Store Connect/i.test(f))).toBe(true);
  });

  it("still grades a real screenshot set even when data is unreliable", () => {
    // If the unreliable source DID return shots, score them normally (they're real).
    const res = score("x", { screenshotUrls: Array.from({ length: 6 }, () => TALL), ipadScreenshotUrls: [], dataReliable: false });
    expect(res.grade).not.toBe("?");
    expect(res.score).toBeGreaterThanOrEqual(50);
  });

  it("keeps the hard F for a genuinely-empty set when data IS reliable", () => {
    const res = score("x", { screenshotUrls: [], ipadScreenshotUrls: [], dataReliable: true });
    expect(res.grade).toBe("F");
  });
});

// #47: the score carries the REAL screenshot URLs (App Store order) so the
// run/audit page can render the actual shots next to the grade. Honesty rule
// (#41): when the set is unreadable ("?"), it carries NO urls — never a fake set.
describe("screenshot scoring — carries the real screenshot urls (#47)", () => {
  const A = "https://is1.mzstatic.com/image/thumb/x/v4/a/b/c/1290x2796bb.png";
  const B = "https://is1.mzstatic.com/image/thumb/x/v4/d/e/f/1290x2796bb.png";
  const IPAD = "https://is1.mzstatic.com/image/thumb/x/v4/g/h/i/2048x2732bb.png";

  it("returns the iPhone + iPad urls verbatim, in order, when the set is readable", () => {
    const res = score("x", { screenshotUrls: [A, B], ipadScreenshotUrls: [IPAD], dataReliable: true });
    expect(res.screenshotUrls).toEqual([A, B]);
    expect(res.ipadScreenshotUrls).toEqual([IPAD]);
  });

  it("carries real urls even from an unreliable source that DID return shots", () => {
    const res = score("x", { screenshotUrls: [A, B], ipadScreenshotUrls: [], dataReliable: false });
    expect(res.grade).not.toBe("?");
    expect(res.screenshotUrls).toEqual([A, B]);
  });

  it("carries NO urls when the set is unreadable (the '?' branch — no fake gallery)", () => {
    const res = score("x", { screenshotUrls: [], ipadScreenshotUrls: [], dataReliable: false });
    expect(res.grade).toBe("?");
    expect(res.screenshotUrls).toEqual([]);
    expect(res.ipadScreenshotUrls).toEqual([]);
  });

  it("never returns null/undefined url arrays (stable shape for the client)", () => {
    const res = score("x", {});
    expect(Array.isArray(res.screenshotUrls)).toBe(true);
    expect(Array.isArray(res.ipadScreenshotUrls)).toBe(true);
  });
});

// #55: convert the (otherwise dead-end) grade into prioritized, quantified,
// grade-aware levers — each a single concrete move with its precise point delta
// and the grade it would reach. Honesty gates: no levers for the unreadable "?"
// case (#41), none for an A-grade set (no headroom), never a no-op, and the
// aspect lever asserts the TARGET ratio, never the thumbnail's literal pixels.
describe("shot levers (#55)", () => {
  const lever = (ls: Lever[], id: Lever["id"]): Lever | undefined => ls.find((l) => l.id === id);

  it("Mangia case (5 iPhone, 0 iPad, wide) → C with a count + aspect lever", () => {
    const s = score("Mangia", listing(5, 0, WIDE));
    expect(s.grade).toBe("C"); // 40 + 5 + 10 + 8 = 63
    const ls = shotLevers(s);
    const count = lever(ls, "count");
    const aspect = lever(ls, "aspect");
    expect(count).toBeDefined();
    expect(count!.delta).toBe(10); // 5 → 6th screenshot
    expect(count!.fromGrade).toBe("C");
    expect(count!.toGrade).toBe("B"); // 63 + 10 = 73
    expect(aspect).toBeDefined();
    expect(aspect!.delta).toBe(10);
  });

  it("toGrade is computed via the real gradeFor (boundary: C@63 + 10 crosses 70 → B)", () => {
    const s = score("x", listing(5, 0, WIDE));
    const count = lever(shotLevers(s), "count")!;
    expect(count.toGrade).toBe(gradeFor(Math.min(100, s.score! + count.delta)));
    expect(count.toGrade).toBe("B");
  });

  it("sorts levers by point delta descending (biggest win first)", () => {
    // 2 iPhone, 0 iPad, tall → count lever (+20) and iPad lever (+10).
    const ls = shotLevers(score("x", listing(2, 0, TALL)));
    expect(ls.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < ls.length; i++) {
      expect(ls[i - 1]!.delta).toBeGreaterThanOrEqual(ls[i]!.delta);
    }
    expect(ls[0]!.id).toBe("count");
    expect(ls[0]!.delta).toBe(20);
  });

  it("emits NO no-op levers for a full tall iPad-backed set (grade A, no headroom)", () => {
    const s = score("x", listing(8, 4, TALL));
    expect(s.grade).toBe("A");
    expect(shotLevers(s)).toEqual([]);
  });

  it("honesty: returns [] for the unreadable '?' / null-score case (#41)", () => {
    const s = score("x", { screenshotUrls: [], ipadScreenshotUrls: [], dataReliable: false });
    expect(s.grade).toBe("?");
    expect(s.score).toBeNull();
    expect(shotLevers(s)).toEqual([]);
  });

  it("never emits a lever with delta <= 0", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 8]) {
      for (const lv of shotLevers(score("x", listing(n, 0, n % 2 ? WIDE : TALL)))) {
        expect(lv.delta).toBeGreaterThan(0);
      }
    }
  });

  it("aspect lever asserts the TARGET ratio (1290×2796), not the user's literal pixels", () => {
    // The wide URL's size token is the iTunes THUMBNAIL (392×696), not the upload
    // resolution — the ratio is reliable, the pixel size is not (#55 honesty rule).
    const aspect = lever(shotLevers(score("x", listing(5, 0, WIDE))), "aspect")!;
    expect(aspect.label + " " + aspect.detail).toContain("1290×2796");
    // Must NOT claim the thumbnail dims (392×696) are the true upload size.
    expect(aspect.label + " " + aspect.detail).not.toContain("392");
    expect(aspect.label + " " + aspect.detail).not.toContain("696");
  });

  it("suppresses the aspect lever when the first shot has no readable dims", () => {
    // A URL with no size token → aspectFromUrl returns null → we can't claim a
    // deficit we can't see, so no aspect lever is emitted.
    const noDims = "https://is1.mzstatic.com/image/thumb/x/v4/a/b/c/no-size-here.png";
    const s = score("x", { screenshotUrls: Array.from({ length: 5 }, () => noDims) });
    expect(aspectFromUrl(noDims)).toBeNull();
    expect(lever(shotLevers(s), "aspect")).toBeUndefined();
  });

  it.each<[number, string, number]>([
    [0, "Add 4+", 40],
    [2, "Fill up to 4", 20],
    [5, "Add a 6th", 10],
  ])("count tier: %i iPhone → action contains %s, delta %i", (n, action, delta) => {
    const count = lever(shotLevers(score("x", listing(n, 1, TALL))), "count")!;
    expect(count).toBeDefined();
    expect(count.label).toContain(action);
    expect(count.delta).toBe(delta);
  });

  it("emits NO count lever once the slot budget is full (6+ iPhone)", () => {
    expect(lever(shotLevers(score("x", listing(6, 1, TALL))), "count")).toBeUndefined();
  });

  it("iPad lever gating: empty iPad set emits a +10 lever; present → none", () => {
    const empty = lever(shotLevers(score("x", listing(5, 0, TALL))), "ipad");
    expect(empty).toBeDefined();
    expect(empty!.delta).toBe(10);
    expect(empty!.skill).toBeFalsy(); // iPad CTA is ASC, not the iPhone-deck skill
    const present = lever(shotLevers(score("x", listing(5, 2, TALL))), "ipad");
    expect(present).toBeUndefined();
  });

  it("count + aspect levers offer the make-it skill linkout; iPad does not", () => {
    const ls = shotLevers(score("x", listing(2, 0, WIDE)));
    expect(lever(ls, "count")!.skill).toBe(true);
    expect(lever(ls, "aspect")!.skill).toBe(true);
    expect(lever(ls, "ipad")!.skill).toBeFalsy();
  });
});

// Step 2 of Google Play support: the store-agnostic `scoreScreenshotGroups`
// scores ANY profile's device families on the SAME budget. iOS stays
// byte-identical (the suite above is unchanged); Android phone/tablet sets now
// get a real grade, and the generalized scorer must AGREE with `score()` on the
// shared budget (no divergence).
describe("scoreScreenshotGroups (store-agnostic, Android phone/tablet)", () => {
  const phone = (n: number, url = TALL) => ({ family: "phone", urls: Array.from({ length: n }, () => url) });
  const tablet = (n: number) => ({ family: "tablet10", urls: Array.from({ length: n }, () => "t") });

  it("scores a full Play phone set (6 tall, no tablet) at 83 → B", () => {
    const s = scoreScreenshotGroups("x", { groups: [phone(6)] }, GOOGLE_PLAY_PROFILE);
    expect(s.score).toBe(83); // 50 (count) + 5 (no secondary) + 20 (tall) + 8 (caption)
    expect(s.grade).toBe("B");
    expect(s.primaryFamily).toBe("phone");
    expect(s.primaryCount).toBe(6);
  });

  it("awards the secondary-coverage bonus for a tablet set", () => {
    const withTablet = scoreScreenshotGroups("x", { groups: [phone(6), tablet(4)] }, GOOGLE_PLAY_PROFILE);
    const phoneOnly = scoreScreenshotGroups("x", { groups: [phone(6)] }, GOOGLE_PLAY_PROFILE);
    expect(withTablet.score!).toBeGreaterThan(phoneOnly.score!);
    expect(withTablet.score).toBe(93); // +10 vs phone-only (15 vs 5 coverage)
    expect(withTablet.grade).toBe("A");
  });

  it("reports every profile family (phone/tablet7/tablet10), never an iPad family", () => {
    const s = scoreScreenshotGroups("x", { groups: [phone(3)] }, GOOGLE_PLAY_PROFILE);
    expect(s.families.map((f) => f.family)).toEqual(["phone", "tablet7", "tablet10"]);
    expect(s.families.some((f) => f.family === "ipad")).toBe(false);
    expect(s.families.find((f) => f.family === "phone")?.count).toBe(3);
  });

  it("honesty (#41): empty primary set from an unreliable source is '?'/null, not F", () => {
    const s = scoreScreenshotGroups("x", { groups: [], reliable: false }, GOOGLE_PLAY_PROFILE);
    expect(s.grade).toBe("?");
    expect(s.score).toBeNull();
    expect(s.findings.some((f) => /Couldn't read/i.test(f))).toBe(true);
  });

  it("keeps a hard F for a genuinely-empty set when the source IS reliable", () => {
    const s = scoreScreenshotGroups("x", { groups: [], reliable: true }, GOOGLE_PLAY_PROFILE);
    expect(s.grade).toBe("F");
    // 5 pts from the no-secondary coverage floor (matches iOS score() for an
    // empty reliable set) — a real, low number, not the null "?" unknown.
    expect(s.score).toBe(5);
  });
});

// The generalized scorer must produce the SAME numeric score as the iOS `score()`
// for the same iPhone/iPad input under the App Store profile — proof the two
// paths share one budget and won't drift.
describe("scoreScreenshotGroups ↔ score() parity (App Store profile)", () => {
  const asGroups = (nIphone: number, nIpad: number, url = TALL) => ({
    groups: [
      { family: "iphone", urls: Array.from({ length: nIphone }, () => url) },
      { family: "ipad", urls: Array.from({ length: nIpad }, () => "ipad") },
    ],
  });

  it.each<[number, number, string]>([
    [5, 0, WIDE],
    [6, 0, TALL],
    [6, 5, TALL],
    [2, 0, TALL],
    [0, 0, TALL],
    [10, 10, TALL],
  ])("iphone=%i ipad=%i agrees with score()", (nIphone, nIpad, url) => {
    const generic = scoreScreenshotGroups("x", asGroups(nIphone, nIpad, url), APP_STORE_PROFILE);
    const ios = score("x", {
      screenshotUrls: Array.from({ length: nIphone }, () => url),
      ipadScreenshotUrls: Array.from({ length: nIpad }, () => "ipad"),
    });
    expect(generic.score).toBe(ios.score);
    expect(generic.grade).toBe(ios.grade);
  });
});
