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

/**
 * A build with no RevenueCat key uploads successfully and ships a DEAD paywall.
 *
 * `mobile/app.config.ts` reads `process.env.REVENUECAT_IOS_KEY ?? ""` at
 * prebuild time. Forget to export it and every step still succeeds: prebuild
 * writes an empty key, the archive signs, the .ipa uploads, and the paywall
 * fails at runtime with `Invalid API Key`. That is the same "nothing is
 * purchasable" 3.1.1 failure that rejected 0.1.0.
 *
 * Four docs told the operator to export it and none enforced it. That is the
 * shape of the bug that rejected 0.1.1 twice — a working mechanism with only a
 * sentence of English standing in front of it. The lane must FAIL instead.
 */
test("the build lane refuses to build without a real RevenueCat iOS key", () => {
  const src = read("mobile/fastlane/Fastfile");
  assert.match(
    src,
    /REVENUECAT_IOS_KEY/,
    "mobile/fastlane/Fastfile must read REVENUECAT_IOS_KEY — app.config.ts defaults it to \"\", so an unset key builds and uploads a dead paywall rather than failing",
  );
  assert.match(
    src,
    /UI\.user_error!.*REVENUECAT_IOS_KEY|REVENUECAT_IOS_KEY[\s\S]{0,400}?UI\.user_error!/,
    "the Fastfile must abort (UI.user_error!) when REVENUECAT_IOS_KEY is missing — a warning is not enough, an uploaded build is already in App Store Connect",
  );
  assert.match(
    src,
    /appl_/,
    "the guard should check the key's `appl_` prefix — a non-empty but wrong-platform key (a Stripe or Android key) fails just as silently",
  );
});

/**
 * `bundle exec fastlane` does not work in this repo — there is no Gemfile.
 *
 * The registry, the gates runsheet, the resubmit checklist and the codebase
 * context all spelled the build command `bundle exec fastlane …`. No Gemfile
 * has ever been tracked here (git log --diff-filter=A over Gemfile paths is
 * empty) and fastlane is installed globally via rbenv, so that command dies
 * with "Could not locate Gemfile" before it does anything.
 *
 * An operator copying the documented command hits an error that looks like a
 * broken toolchain rather than a wrong doc. Keep every doc on the command that
 * actually runs.
 */
test("no doc tells the operator to run the build with `bundle exec`", () => {
  const docs = [
    ".claude/codebase-context.md",
    "docs/shipaton/gates-runsheet.md",
    "docs/shipaton/registry.md",
    "marketing/aso/shipaso/resubmit-0.1.1-checklist.md",
  ];
  for (const doc of docs) {
    assert.doesNotMatch(
      read(doc),
      /bundle exec fastlane/,
      `${doc} says \x60bundle exec fastlane\x60, but this repo has no Gemfile — that command fails with "Could not locate Gemfile". The working command is \x60fastlane ios <lane>\x60.`,
    );
  }
});
