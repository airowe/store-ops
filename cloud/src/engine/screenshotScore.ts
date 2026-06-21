/**
 * Screenshot ASO scorer — ported faithfully from aso_screenshot_score.py.
 *
 * Scores the DETERMINISTIC, structural things: count, iPad coverage, aspect/
 * device targeting (derived from the size token in the screenshot URL, e.g.
 * "1290x2796bb.png"). It does NOT OCR captions or judge design.
 *
 * Point budget (identical to the Python `score`):
 *   count   : 0 shots → +0 (F-bound) · <GOOD_MIN → +20 · ≥6 → +50 · 4–5 → +40
 *   iPad    : present → +15 · none → +5
 *   aspect  : tall (h/w ≥ TALL_RATIO) → +20 · other ratio → +10 · no dims → +10
 *   caption : no --fetch path → +8 neutral credit (we don't fetch images here)
 *   total capped at 100; grade A≥85 B≥70 C≥50 D≥30 else F.
 */
import { SCREENSHOT } from "./constants.js";

const { MAX_SLOTS, GOOD_MIN, KEY_SLOTS, TALL_RATIO } = SCREENSHOT;

export type Listing = {
  screenshotUrls?: string[] | null;
  ipadScreenshotUrls?: string[] | null;
  /**
   * Whether the screenshot data source is trustworthy for absence (#41). The
   * public iTunes Search API frequently returns NO screenshots for apps that
   * actually have them, so an empty set from it means UNKNOWN, not zero. Pass
   * `false` for public-API data: an empty set then grades "?" (unknown) instead
   * of a false "grade F / can't convert". Defaults to `true` (legacy behavior).
   */
  dataReliable?: boolean;
};

// "?" = unknown: we couldn't read the screenshots from a trustworthy source.
export type Grade = "A" | "B" | "C" | "D" | "F" | "?";

export type ShotScore = {
  app: string;
  iphoneCount: number;
  ipadCount: number;
  score: number | null; // 0–100, or null when grade is "?" (unknown/unreadable)
  grade: Grade;
  findings: string[];
  aspectHint: string;
  /**
   * The REAL screenshot URLs we graded, in App Store order (#47) — so the
   * run/audit page can render the actual shots next to the grade. iPhone set
   * first, iPad set second. Empty when the set is unreadable (the "?" branch):
   * never a fake/placeholder gallery (#41). These are public App Store image
   * URLs, safe to serve past the findings-only privacy boundary.
   */
  screenshotUrls: string[];
  ipadScreenshotUrls: string[];
  /**
   * Prioritized, quantified C→B→A improvement levers (#55), derived from the SAME
   * scoring budget. Computed engine-side so the client is a dumb renderer (one
   * TDD'd source of truth, like `findings`/`aspectHint`). Empty for the unreadable
   * "?" set and for an A-grade set (no headroom) — both honest no-panel states.
   */
  levers: Lever[];
};

/**
 * Apple's iTunes/ASC image URLs end in an UNSUBSTITUTED size template, e.g.
 * `…/iphone-6.5_05.png/{w}x{h}bb.{f}`. The `{w}` `{h}` `{f}` (and optional `{c}`
 * crop) tokens are placeholders the CLIENT is expected to fill with concrete
 * width/height/format before requesting the image. If they reach an `<img src>`
 * untouched, the browser percent-encodes the braces (`%7Bw%7D…`) and Apple's CDN
 * returns 404 — every screenshot renders broken (and `aspectFromUrl` can't read
 * the dimensions, silently degrading the aspect score too).
 *
 * `resolveShotUrl` substitutes the tokens with the image's NATIVE dimensions so
 * the URL loads AND the size token still encodes the true aspect ratio. Native
 * (not downscaled) dims keep `aspectFromUrl` honest; the browser downscales for
 * display and `loading="lazy"` keeps it cheap. Idempotent: a URL with no tokens
 * is returned unchanged.
 */
const SHOT_NATIVE_W = 1290;
const SHOT_NATIVE_H = 2796;
export function resolveShotUrl(url: string): string {
  if (!url.includes("{")) return url;
  return url
    .replace("{w}", String(SHOT_NATIVE_W))
    .replace("{h}", String(SHOT_NATIVE_H))
    .replace("{c}", "") // optional crop token — empty keeps Apple's default
    .replace("{f}", "png");
}

/** Parse the size token at the end of a screenshot URL → [w, h] or null. */
export function aspectFromUrl(url: string): [number, number] | null {
  const m = url.match(/\/(\d{2,4})x(\d{2,4})[a-z]{0,3}\.(png|jpg|jpeg)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Human label for an aspect ratio (Python `_aspect_label`). */
export function aspectLabel(w: number, h: number): string {
  const r = w ? h / w : 0;
  if (r >= 2.0) return "tall phone (≈19.5:9 — modern iPhone)";
  if (r >= 1.7) return "phone (≈16:9)";
  if (r >= 1.2) return "tablet / landscape";
  return "unusual ratio";
}

export function gradeFor(pts: number): Grade {
  if (pts >= 85) return "A";
  if (pts >= 70) return "B";
  if (pts >= 50) return "C";
  if (pts >= 30) return "D";
  return "F";
}

/**
 * The make-it tool for the count/aspect levers (#55) — the same MIT skill the
 * findings linkout already points at (`app.js` `SHOTS_SKILL`). The agent NEVER
 * generates or pushes assets: this is a linkout for the human to act on.
 */
export const SHOTS_SKILL = "https://github.com/ParthJadhav/app-store-screenshots";

/** Native tall-phone target the aspect lever recommends (the GOAL ratio). */
const TALL_TARGET = { w: SHOT_NATIVE_W, h: SHOT_NATIVE_H } as const;

/**
 * A quantified, grade-aware improvement lever derived from the EXISTING screenshot
 * scoring budget (#55). Each lever is a single concrete move with the precise point
 * delta and the grade it would reach if applied alone — turning the dead-end grade
 * into a prioritized worklist. No new scoring dimensions; honesty gates baked in.
 */
export type Lever = {
  id: "count" | "ipad" | "aspect";
  label: string; // plain-language action, e.g. "Add a 6th screenshot"
  detail: string; // honest caveat / why
  delta: number; // point gain (> 0 always — never a no-op lever)
  fromGrade: Grade; // current grade
  toGrade: Grade; // grade if THIS lever alone is applied
  skill?: boolean; // true → offer the app-store-screenshots skill linkout
};

/**
 * Derive prioritized, quantified C→B→A levers from a computed `ShotScore` (#55).
 *
 * Pure: re-derives, from the SAME budget `score()` used, the delta to the next tier
 * for each deficit and the grade that results — via the real `gradeFor`, so a budget
 * change that breaks the mapping fails CI. Honesty gates:
 *   - unreadable ("?") / null score → [] (no panel; the #41 empty-state stands alone)
 *   - A-grade / no headroom → [] (never over-sell a finished listing)
 *   - never a lever with delta <= 0
 *   - the aspect lever asserts the TARGET ratio, never the thumbnail's literal pixels
 * Sorted by delta desc; stable tie-break order count > aspect > ipad.
 */
export function shotLevers(s: ShotScore): Lever[] {
  // Honesty gate (#41): no panel when we couldn't read the real shots.
  if (s.grade === "?" || s.score === null) return [];
  const base = s.score;
  const levers: Lever[] = [];

  const add = (
    id: Lever["id"],
    label: string,
    detail: string,
    delta: number,
    skill: boolean,
  ): void => {
    if (delta <= 0) return; // never a no-op lever
    levers.push({
      id,
      label,
      detail,
      delta,
      fromGrade: s.grade,
      toGrade: gradeFor(Math.min(100, base + delta)),
      ...(skill ? { skill: true } : {}),
    });
  };

  // count — the biggest lever. Surface the LARGEST single realistic next step to
  // the next count tier (0→+0, 1–3→+20, 4–5→+40, 6+→+50), so we never over-
  // congratulate a "5 shots (good)" set that a 6th shot would out-score.
  const n = s.iphoneCount;
  if (n === 0) {
    add(
      "count",
      `Add ${GOOD_MIN}+ screenshots`,
      `An empty deck can't convert. Fill at least ${GOOD_MIN} of your ${MAX_SLOTS} slots — the first ${KEY_SLOTS} carry most installs.`,
      40,
      true,
    );
  } else if (n < GOOD_MIN) {
    add(
      "count",
      `Fill up to ${GOOD_MIN}–5 slots`,
      `You're using ${n} of ${MAX_SLOTS} slots — reaching ${GOOD_MIN}–5 jumps the count tier. The first ${KEY_SLOTS} carry most installs.`,
      20,
      true,
    );
  } else if (n < 6) {
    add(
      "count",
      "Add a 6th screenshot",
      `${n} shots is solid, but a 6th uses your slot budget fully — 6+ scores higher than ${GOOD_MIN}–5.`,
      10,
      true,
    );
  }

  // aspect — only when we have REAL dims AND they're not already tall. The size
  // token may be the iTunes THUMBNAIL (e.g. 392×696), not the upload resolution —
  // the RATIO is reliable, the literal pixels are not. Copy asserts the target
  // ratio, never the user's current pixel size as a measured fact.
  const firstUrl = s.screenshotUrls[0];
  const dims = firstUrl ? aspectFromUrl(firstUrl) : null;
  if (dims) {
    const [w, h] = dims;
    if (h / w < TALL_RATIO) {
      add(
        "aspect",
        `Use a modern tall-phone aspect (${TALL_TARGET.w}×${TALL_TARGET.h})`,
        `Your shots aren't tall-phone ratio. Target the ${TALL_TARGET.w}×${TALL_TARGET.h} (≈19.5:9) ratio modern iPhones use — we read the ratio, not your exact upload pixels.`,
        10,
        true,
      );
    }
  }

  // ipad — only when the iPad set is empty. Conditional copy ("if you ship iPad");
  // the CTA is App Store Connect, not the iPhone-deck skill (skill:false). delta =
  // present (+15) vs none (+5) = +10.
  if (s.ipadCount === 0) {
    add(
      "ipad",
      "Add iPad screenshots",
      "If you ship a universal (iPad) app, an empty iPad deck leaves that surface blank. Skip this if you're iPhone-only.",
      10,
      false,
    );
  }

  // Sort by delta desc; stable tie-break order count > aspect > ipad.
  const ORDER: Record<Lever["id"], number> = { count: 0, aspect: 1, ipad: 2 };
  levers.sort((a, b) => b.delta - a.delta || ORDER[a.id] - ORDER[b.id]);
  return levers;
}

/** Score a listing's screenshot set. Pure; no network (caption heuristic off). */
export function score(app: string, listing: Listing): ShotScore {
  // Resolve Apple's {w}x{h}bb.{f} URL templates to real, loadable URLs up front
  // so BOTH the aspect score (reads dims from the URL) and the gallery (#47)
  // operate on URLs that actually 200 — never the broken templated form.
  const iphone = (listing.screenshotUrls ?? []).map(resolveShotUrl);
  const ipad = (listing.ipadScreenshotUrls ?? []).map(resolveShotUrl);
  const findings: string[] = [];
  let pts = 0;

  // #41: an empty set from an UNRELIABLE source (the public iTunes API) is
  // UNKNOWN, not zero — never assert a false "grade F / can't convert". Only
  // when the source returned NO iPhone shots do we fall back to unknown; if it
  // returned real shots, score them normally below (they're trustworthy).
  if (iphone.length === 0 && listing.dataReliable === false) {
    return {
      app,
      iphoneCount: 0,
      ipadCount: ipad.length,
      score: null,
      grade: "?",
      findings: [
        "ℹ Couldn't read your screenshots from public App Store data — this is often incomplete. " +
          "Connect App Store Connect to audit your real screenshot set.",
      ],
      aspectHint: "",
      // #47 + #41: unreadable set → carry NO urls. Never render a fake gallery.
      screenshotUrls: [],
      ipadScreenshotUrls: [],
      // #55: no panel in the unreadable case — the honest empty-state stands alone.
      levers: [],
    };
  }

  // count — the biggest lever (up to 50)
  const n = iphone.length;
  if (n === 0) {
    findings.push("✗ No iPhone screenshots — the listing can't convert. Add 4+.");
  } else if (n < GOOD_MIN) {
    findings.push(
      `⚠ Only ${n} iPhone screenshots — add up to ${MAX_SLOTS}; ` +
        `the first ${KEY_SLOTS} carry most installs.`,
    );
    pts += 20;
  } else {
    findings.push(`✓ ${n} iPhone screenshots (good — slots well used).`);
    pts += n >= 6 ? 50 : 40;
  }

  // iPad set — 15 pts
  if (ipad.length > 0) {
    findings.push(`✓ ${ipad.length} iPad screenshots present.`);
    pts += 15;
  } else {
    findings.push("⚠ No iPad screenshots — fine if iPhone-only; add them if universal.");
    pts += 5;
  }

  // aspect / device targeting — 20 pts
  let aspectHint = "";
  if (iphone.length > 0) {
    const dims = aspectFromUrl(iphone[0] as string);
    if (dims) {
      const [w, h] = dims;
      aspectHint = aspectLabel(w, h);
      if (h / w >= TALL_RATIO) {
        findings.push(`✓ Modern tall-phone ratio (${w}×${h}).`);
        pts += 20;
      } else {
        findings.push(
          `⚠ Screenshots are ${w}×${h} (${aspectHint}) — verify they fit current devices.`,
        );
        pts += 10;
      }
    } else {
      pts += 10;
    }
  }

  // caption heuristic — only with --fetch in Python; here we always take the
  // neutral partial-credit branch (+8) and surface the info finding.
  if (iphone.length > 0) {
    findings.push(
      "ℹ Run the caption check (image fetch) for a light first-screenshot review.",
    );
    pts += 8;
  }

  pts = Math.min(100, pts);
  const result: ShotScore = {
    app,
    iphoneCount: n,
    ipadCount: ipad.length,
    score: pts,
    grade: gradeFor(pts),
    findings,
    aspectHint,
    // #47: the real shots we just graded, in App Store order — for the gallery.
    screenshotUrls: [...iphone],
    ipadScreenshotUrls: [...ipad],
    levers: [],
  };
  // #55: attach the quantified C→B→A levers, derived from THIS score's budget.
  // Engine-side compute = single TDD'd source of truth; the client renders only.
  result.levers = shotLevers(result);
  return result;
}
