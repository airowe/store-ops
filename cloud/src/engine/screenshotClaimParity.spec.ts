/**
 * The screenshot "key slots" claim is mirrored Python ↔ TypeScript, and both
 * sides must say the SAME thing. Two sources have to agree:
 *
 *   lib/aso_screenshot_score.py        KEY_SLOTS + the finding copy
 *   engine/{constants,screenshotScore} SCREENSHOT.KEY_SLOTS + the finding copy
 *
 * Why the copy and not just the number: the old wording — "the first N carry
 * most installs" — asserted a CONVERSION OUTCOME. Apple's creative assets
 * (fall 2026) add a dedicated search-results asset that displaces screenshots
 * 1–3 in search, so for any app that has one the claim is false. It was
 * replaced everywhere by a POSITIONAL statement ("are what search shows
 * today"), which is verifiable now and degrades honestly when the fall change
 * lands. See docs/prd/visual-assets/05-creative-assets.md (§A1) and #436.
 *
 * `constants.spec.ts` already pins the NUMBER, but it hardcodes 3 on the TS
 * side — so it catches a TS refactor and misses a Python one. This reads the
 * Python source text instead, which is the only way to fail when the mirror
 * drifts on the far side.
 *
 * NOT covered here: cloud/src/engine/play/playFindings.ts carries the same
 * sentence legitimately. Google Play has no creative-asset surface, so the
 * causal claim still holds there and is deliberately excluded.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCREENSHOT } from "./constants.js";
import { score } from "./screenshotScore.js";

const PY_PATH = fileURLToPath(
  new URL("../../../lib/aso_screenshot_score.py", import.meta.url).href,
);
const TS_COPY_PATHS = ["./screenshotScore.ts", "./auditFindings.ts"].map((p) =>
  fileURLToPath(new URL(p, import.meta.url).href),
);

/**
 * The SKILL doc quotes the same finding copy, and it is the surface a plugin
 * user actually reads — the engine can be correct while the doc still teaches
 * the old claim. It shipped that way: every engine site was corrected and
 * `skills/aso-screenshot-score/SKILL.md` kept "carry most installs" until it
 * was found by sweeping #436 by hand. This guard only ever read engine
 * sources, so nothing failed.
 */
const DOC_PATHS = ["../../../skills/aso-screenshot-score/SKILL.md"].map((p) =>
  fileURLToPath(new URL(p, import.meta.url).href),
);

/**
 * The doc legitimately NAMES the retired wording to explain why it is retired,
 * so a whole-file scan passes on a doc that teaches the wrong thing — the
 * explanation satisfies the check while the example above it stays wrong.
 * Verified: reverting only the example still passed a whole-file guard.
 *
 * So read the EXAMPLE FINDING — the quoted `*"⚠ …"*` block — and judge that.
 */
function docFindingCopy(path: string): string {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const m = /\*"⚠[\s\S]*?"\*/.exec(text);
  if (!m) throw new Error(`no example finding (*"⚠ …"*) found in ${path}`);
  return m[0].replace(/\n/g, " ");
}

/** The positional phrasing both sides must use. */
const POSITIONAL = "are what search shows today";
/**
 * Causal phrasings neither side may reintroduce. More than one wording of the
 * same defect shipped — "convert hardest" survived the first sweep precisely
 * because it was grepped for "carry most installs". Add any new variant here.
 */
const CAUSAL_CLAIMS = ["carry most installs", "convert hardest"] as const;

const py = () => readFileSync(PY_PATH, "utf8");

/** `KEY_SLOTS = 3` as literally written in the Python source. */
function pythonKeySlots(): number {
  const m = /^KEY_SLOTS\s*=\s*(\d+)/m.exec(py());
  if (!m) throw new Error("KEY_SLOTS assignment not found in aso_screenshot_score.py");
  return Number(m[1]);
}

describe("screenshot key-slots claim parity (Python ↔ TypeScript)", () => {
  it("KEY_SLOTS matches the Python source, not a hardcoded copy of it", () => {
    expect(SCREENSHOT.KEY_SLOTS).toBe(pythonKeySlots());
  });

  it("the Python finding copy uses the positional claim", () => {
    expect(py()).toContain(POSITIONAL);
  });

  it.each(TS_COPY_PATHS)("%s uses the positional claim", (path) => {
    expect(readFileSync(path, "utf8")).toContain(POSITIONAL);
  });

  it.each(DOC_PATHS)("%s shows the positional claim in its EXAMPLE finding", (path) => {
    expect(docFindingCopy(path)).toContain(POSITIONAL);
  });

  it.each(CAUSAL_CLAIMS)("neither side reintroduces the causal %o claim", (claim) => {
    const offenders = [
      ...[PY_PATH, ...TS_COPY_PATHS].filter((p) => readFileSync(p, "utf8").includes(claim)),
      // For the doc, only the EXAMPLE finding counts — see docFindingCopy.
      ...DOC_PATHS.filter((p) => docFindingCopy(p).includes(claim)),
    ];
    expect(offenders).toEqual([]);
  });

  it("the rendered finding says it positionally, at the shared KEY_SLOTS value", () => {
    // The same fixture the Python case uses: a thin deck (< GOOD_MIN) with a
    // reliable source triggers the count finding on both sides.
    const findings = score("x", {
      screenshotUrls: ["u", "u"],
      ipadScreenshotUrls: [],
      dataReliable: true,
    }).findings.join(" ");

    expect(findings).toContain(`the first ${SCREENSHOT.KEY_SLOTS} ${POSITIONAL}`);
    for (const claim of CAUSAL_CLAIMS) expect(findings).not.toContain(claim);
  });
});
