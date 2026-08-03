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
 * Where the .ipa actually lands.
 *
 * `output_directory: "./builds"` is relative to fastlane's working directory,
 * which is `mobile/` — so the artifact is `mobile/builds/ShipASO.ipa`, NOT
 * `mobile/fastlane/builds/`. The lane's own success message prints the wrong
 * path, and this doc repeated it until a real build was run and the artifact
 * was found somewhere else. Anyone looking for the .ipa follows this line.
 */
test("the build lane writes the .ipa to mobile/builds/", () => {
  const src = read("mobile/fastlane/Fastfile");
  assert.match(
    src,
    /output_directory:\s*"\.\/builds"/,
    'the build lane should keep output_directory: "./builds" (resolved from mobile/) — if this moves, fix the path named in .claude/codebase-context.md too',
  );
  assert.doesNotMatch(
    read(".claude/codebase-context.md"),
    /mobile\/fastlane\/builds/,
    "the context names a builds directory that does not exist — the .ipa lands in mobile/builds/, because output_directory is relative to mobile/, not fastlane/",
  );
});

/**
 * The Fastfile must not describe the artifact as living under fastlane/.
 *
 * A draft of the artifact-existence check used
 * `File.expand_path("builds/ShipASO.ipa", __dir__)` — `__dir__` is
 * `mobile/fastlane/`, so it looked for a file in a directory that has never
 * existed. Being a post-build assertion, it would have failed EVERY successful
 * build: the exact inverse of the silent-success bug it was written to catch.
 */
test("the Fastfile does not look for the .ipa under fastlane/", () => {
  // Ruby comments stripped: the Fastfile explains this very trap in prose, and
  // matching raw source flagged the explanation as the violation.
  const src = read("mobile/fastlane/Fastfile")
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(
    src,
    /expand_path\(\s*"builds\/[^"]*"\s*,\s*__dir__/,
    'this resolves to mobile/fastlane/builds/, which does not exist. The .ipa is at mobile/builds/ — anchor to __dir__\'s PARENT: File.expand_path("../builds/ShipASO.ipa", __dir__).',
  );
  assert.doesNotMatch(
    src,
    /mobile\/fastlane\/builds/,
    "the Fastfile names mobile/fastlane/builds/ — no such directory; the success message used to claim this and sent people looking in the wrong place",
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
