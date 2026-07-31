import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * The iOS app is built with FASTLANE, not EAS.
 *
 * `mobile/eas.json` is tracked and `eas whoami` succeeds, so `eas build` looks
 * like the build path to anyone (or any agent) reading the repo cold. It is
 * not — the real pipeline is `mobile/fastlane/Fastfile` (#247). JSON cannot
 * carry a comment, so this test is where that fact lives.
 *
 * This is a documentation guard, not a behaviour guard: it asserts the fastlane
 * lanes still exist and that the codebase context still says so, so the two
 * cannot drift apart silently. If the project genuinely moves to EAS, delete
 * this test deliberately rather than letting it rot.
 */
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

test("the fastlane build + upload lanes exist", () => {
  const fastfile = join(repoRoot, "mobile/fastlane/Fastfile");
  assert.ok(existsSync(fastfile), "mobile/fastlane/Fastfile is missing — it is the iOS build pipeline");

  const src = readFileSync(fastfile, "utf8");
  for (const lane of ["build", "upload"]) {
    assert.match(
      src,
      new RegExp(`lane :${lane}\\b`),
      `mobile/fastlane/Fastfile no longer defines lane :${lane}`,
    );
  }
});

/**
 * The upload lane must NOT submit for review. Uploading a binary is reversible;
 * submitting is the irreversible human step this whole codebase reserves for a
 * person. `upload_to_testflight` puts the build in App Store Connect and stops.
 */
test("the upload lane uploads but does not submit for review", () => {
  const src = read("mobile/fastlane/Fastfile");
  assert.match(src, /upload_to_testflight/, "the upload lane should use upload_to_testflight");
  assert.doesNotMatch(
    src,
    /submit_for_review:\s*true|deliver\(/,
    "the fastlane pipeline must not submit for review — approving is not shipping, and submitting is the human's step",
  );
});

/**
 * The trap itself: eas.json exists and will mislead. Keep the correction
 * written down somewhere an agent reads before touching the build.
 */
test("the codebase context records that builds go through fastlane, not EAS", () => {
  const ctx = read(".claude/codebase-context.md");
  assert.match(
    ctx,
    /FASTLANE, not EAS/i,
    ".claude/codebase-context.md must state that the iOS app builds with fastlane — mobile/eas.json is tracked and makes `eas build` look correct",
  );
  assert.match(
    ctx,
    /fastlane\/Fastfile/,
    "the context must name mobile/fastlane/Fastfile so the reader can find the real pipeline",
  );
});
