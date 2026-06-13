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
};

export type Grade = "A" | "B" | "C" | "D" | "F";

export type ShotScore = {
  app: string;
  iphoneCount: number;
  ipadCount: number;
  score: number; // 0–100
  grade: Grade;
  findings: string[];
  aspectHint: string;
};

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

function gradeFor(pts: number): Grade {
  if (pts >= 85) return "A";
  if (pts >= 70) return "B";
  if (pts >= 50) return "C";
  if (pts >= 30) return "D";
  return "F";
}

/** Score a listing's screenshot set. Pure; no network (caption heuristic off). */
export function score(app: string, listing: Listing): ShotScore {
  const iphone = listing.screenshotUrls ?? [];
  const ipad = listing.ipadScreenshotUrls ?? [];
  const findings: string[] = [];
  let pts = 0;

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
  return {
    app,
    iphoneCount: n,
    ipadCount: ipad.length,
    score: pts,
    grade: gradeFor(pts),
    findings,
    aspectHint,
  };
}
