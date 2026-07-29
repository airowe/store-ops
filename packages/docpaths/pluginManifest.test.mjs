import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * The plugin manifests must actually install.
 *
 * shipaso.com advertises the plugin on four pages — index, install,
 * check-your-rank and report — with a copy-paste install block:
 *
 *   /plugin marketplace add airowe/store-ops
 *   /plugin install store-ops@store-ops
 *
 * That second command FAILED for every visitor, and nothing here noticed. The
 * manifest had `author` as a string (the schema wants an object) and a `skills`
 * array (not a manifest field at all — Claude Code discovers skills from the
 * skills/ directory). Both are silent until someone runs the install, which no
 * test, no CI job and no deploy step ever did.
 *
 * The landing page is a promise; this is what keeps it true. A broken manifest
 * is worse than a broken page, because the marketing keeps working and only the
 * product fails.
 *
 * Deliberately schema-shape assertions rather than a JSON-Schema dependency:
 * these are the two fields that actually broke, plus the invariants that make
 * the advertised commands resolve.
 */
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const readJson = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
const plugin = readJson(".claude-plugin/plugin.json");
const marketplace = readJson(".claude-plugin/marketplace.json");

test("plugin.json: author is an OBJECT, never a bare string", () => {
  // The exact failure: `"author": "airowe"` →
  // "author: Invalid input: expected object, received string".
  assert.equal(
    typeof plugin.author,
    "object",
    "author must be an object like { name, url } — a string fails validation",
  );
  assert.ok(plugin.author !== null && !Array.isArray(plugin.author), "author must be a plain object");
  assert.ok(plugin.author.name, "author.name is required");
});

test("plugin.json: declares no `skills` field", () => {
  // The other half of the failure: "skills: Invalid input". Skills are
  // DISCOVERED from skills/ ("Components will be discovered at installation"),
  // so declaring them is both redundant and fatal. Superpowers ships a large
  // skills library and declares none.
  assert.equal(
    plugin.skills,
    undefined,
    "`skills` is not a manifest field — remove it; skills/ is auto-discovered",
  );
});

test("plugin.json: has the identity fields the install surfaces", () => {
  for (const field of ["name", "version", "description"]) {
    assert.ok(plugin[field], `plugin.json is missing "${field}"`);
  }
});

test("marketplace.json: the advertised install target resolves", () => {
  // `/plugin install store-ops@store-ops` is <plugin>@<marketplace>, so both
  // names are part of the published contract — renaming either breaks the copy
  // block on four landing pages.
  assert.equal(marketplace.name, "store-ops", "marketplace name is advertised in the install command");
  const names = (marketplace.plugins ?? []).map((p) => p.name);
  assert.ok(
    names.includes("store-ops"),
    `marketplace must offer a plugin named "store-ops"; got ${JSON.stringify(names)}`,
  );
});

test("marketplace.json: every plugin source exists", () => {
  for (const p of marketplace.plugins ?? []) {
    assert.ok(
      existsSync(join(repoRoot, p.source)),
      `plugin "${p.name}" points at a missing source: ${p.source}`,
    );
  }
});

/**
 * The skills themselves. Auto-discovery means a directory without a SKILL.md is
 * silently not a skill — it would install "successfully" and simply do less
 * than advertised, which is the failure mode hardest to notice.
 */
test("every skills/ directory is a real skill (has SKILL.md)", () => {
  const skillsDir = join(repoRoot, "skills");
  const dirs = readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory());
  assert.ok(dirs.length > 0, "skills/ is empty");
  const broken = dirs.filter((d) => !existsSync(join(skillsDir, d, "SKILL.md")));
  assert.deepEqual(broken, [], `skill directories without SKILL.md: ${broken.join(", ")}`);
});

/**
 * The landing pages state a skill COUNT. It was "27" while the repo shipped 28
 * — undercounting, so nobody was misled, but it is a measurable claim about the
 * product and it was wrong. Asserted against the directory count so the number
 * cannot drift again in either direction.
 */
test("the skill count advertised on the landing pages matches reality", () => {
  const skillsDir = join(repoRoot, "skills");
  const actual = readdirSync(skillsDir).filter((d) =>
    existsSync(join(skillsDir, d, "SKILL.md")),
  ).length;

  // README.md included deliberately: it stated "26 skills" in three places
  // while the repo shipped 29, and this test did not look at it. The landing
  // pages were right the whole time, so checking only them proved nothing about
  // the file most contributors actually read.
  const pages = ["docs/landing/index.html", "docs/landing/install.html", "README.md"];
  const claims = [];
  for (const page of pages) {
    const html = readFileSync(join(repoRoot, page), "utf8");
    for (const m of html.matchAll(/(\d+)\s*skills/gi)) claims.push({ page, n: Number(m[1]) });
  }
  assert.ok(claims.length > 0, "no page states a skill count — expected the install/index copy to");
  for (const { page, n } of claims) {
    assert.equal(n, actual, `${page} advertises ${n} skills; the repo ships ${actual}`);
  }
});

/**
 * The README must NAME every skill, not just count them.
 *
 * It documented 4 of 29 by name and summarised the rest as a prose blob —
 * "metadata sync, localization, PPP pricing, screenshots…". Every Google Play
 * skill, the whole write lane, and all the risk/verify skills were unfindable
 * by name in the file most people read first. A skill nobody can name is a
 * skill nobody invokes.
 *
 * Matches the leading `| \`name\`` cell of a table row, which is how the Skills
 * section lists them.
 */
test("the README names every skill the repo ships", () => {
  const skillsDir = join(repoRoot, "skills");
  const shipped = readdirSync(skillsDir).filter((d) =>
    existsSync(join(skillsDir, d, "SKILL.md")),
  );

  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const listed = new Set(
    [...readme.matchAll(/^\|\s*`([a-z0-9-]+)`/gim)].map((m) => m[1]),
  );

  const missing = shipped.filter((s) => !listed.has(s));
  assert.deepEqual(
    missing,
    [],
    `these skills ship but are not named in the README: ${missing.join(", ")}`,
  );

  // The other direction: a README row for a skill that no longer exists sends
  // the reader to an invocation that fails.
  const phantom = [...listed].filter((n) => !shipped.includes(n));
  assert.deepEqual(
    phantom,
    [],
    `the README lists skills that do not exist: ${phantom.join(", ")}`,
  );
});

/**
 * A skill that ships without a version bump is INVISIBLE.
 *
 * `asc-metadata-write-lane` was merged, deployed, and documented — and
 * `/plugin marketplace update` did not install it, because the cache keys on
 * plugin.json's `version` and it had sat at 0.1.0 across every skill added
 * since. The user ran the update, got "✔ Updated 1 marketplace", and still had
 * the old skill set. Nothing reported a problem.
 *
 * This pins the two facts that make a refresh actually happen: the version is
 * present and parseable, and the marketplace agrees with it. Bumping is then a
 * deliberate step someone can see in a diff, not a thing to remember.
 */
test("plugin.json declares a semver version", () => {
  assert.match(
    String(plugin.version ?? ""),
    /^\d+\.\d+\.\d+$/,
    "plugin.json needs a semver `version` — the plugin cache keys on it, and a stale version means new skills never install",
  );
});

/**
 * Every skill that WRITES to Apple must make the user choose the key.
 *
 * `asc` resolves credentials from a default profile. A developer with a client
 * key and a personal key has two, and the default is whichever was registered
 * last. A push through the wrong one does not error — it succeeds, against the
 * wrong account, and stays invisible until it lands on someone's live listing.
 *
 * Prose is the only place this can live (the skills are markdown), so prose is
 * what gets pinned. Asserted on `asc auth status` specifically: it is the
 * command that makes the choice visible, and a skill that mentions keys without
 * it is telling the user to care without telling them how to look.
 */
test("every write-capable asc skill tells the user to confirm the key first", () => {
  // Skills that mutate Apple state. Read-only skills (asc-id-resolver,
  // asc-submission-health) are deliberately excluded: picking the wrong profile
  // there returns wrong data, which is visible, not a silent bad write.
  const writeSkills = [
    "asc-metadata-write-lane",
    "asc-localize-metadata",
    "asc-ppp-pricing",
  ];

  for (const skill of writeSkills) {
    const md = readFileSync(join(repoRoot, "skills", skill, "SKILL.md"), "utf8");
    assert.match(
      md,
      /asc auth status/,
      `${skill} writes to a real Apple account but never tells the user to run \`asc auth status\` — with two profiles registered, it will push through whichever happens to be default`,
    );
  }
});

/**
 * The `.p8` must never transit the transcript.
 *
 * `asc auth login` takes `--private-key <path>` and reads the file itself. An
 * agent that instead asks the user to paste the key contents leaks unrevocable
 * material into a chat log — Apple lets you download a key exactly once, so the
 * only remedy is revoking it. The skill says so; this keeps it saying so.
 */
test("the write lane forbids pasting .p8 contents and passes a path instead", () => {
  const md = readFileSync(
    join(repoRoot, "skills", "asc-metadata-write-lane", "SKILL.md"),
    "utf8",
  );
  assert.match(
    md,
    /--private-key/,
    "the key-registration example must pass the .p8 by PATH via --private-key",
  );
  assert.match(
    md,
    /[Nn]ever ask the user to paste the `?\.p8/,
    "the skill must explicitly forbid pasting .p8 contents into the conversation",
  );
});

test("marketplace metadata version matches plugin.json", () => {
  const mv = marketplace.metadata?.version;
  if (mv === undefined) return; // optional field; only checked when present
  assert.equal(
    mv,
    plugin.version,
    "marketplace.json and plugin.json disagree on the version — the refresh a user gets is then ambiguous",
  );
});
