import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, lstatSync, readlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * ShipASO must stay runnable from ANY coding agent.
 *
 * The skills were always portable — plain Markdown over plain CLI tools, with
 * only `name`/`description` frontmatter. What was NOT portable was the front
 * door: the README said "Install (in Claude Code)" and offered only
 * `/plugin marketplace add`, a command that does not exist in Codex, Cursor,
 * Copilot, Gemini, or Aider. A user arriving from any of those bounced.
 *
 * `AGENTS.md` is the source of truth. Every other entry point POINTS at it
 * rather than copying it — a copy is how two docs drift into disagreeing, which
 * this repo has been bitten by before (`mobile/STORE.md` sent people to a
 * deleted directory for weeks).
 *
 * These guards exist because a pointer file that silently stops pointing is
 * indistinguishable from one that works, right up until a user follows it.
 */
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

/** Every per-agent pointer file, and the agent it serves. */
const POINTERS = [
  { file: ".cursor/rules/shipaso.mdc", agent: "Cursor" },
  { file: ".github/copilot-instructions.md", agent: "GitHub Copilot" },
];

test("AGENTS.md exists — every pointer depends on it", () => {
  assert.ok(
    existsSync(join(repoRoot, "AGENTS.md")),
    "AGENTS.md is the source of truth for all agent entry points; the pointer files, the README, and GEMINI.md all lead here",
  );
});

for (const { file, agent } of POINTERS) {
  test(`${agent}'s pointer file exists and leads to AGENTS.md`, () => {
    assert.ok(existsSync(join(repoRoot, file)), `${file} is missing — ${agent} has no entry point`);
    assert.match(
      read(file),
      /AGENTS\.md/,
      `${file} must send the agent to AGENTS.md rather than restating it — duplicated guidance drifts`,
    );
  });

  /**
   * The whole reason these files are thin. If one grows into a full copy of
   * AGENTS.md, it will eventually disagree with it, and nothing will notice.
   */
  test(`${agent}'s pointer file stays a pointer, not a copy`, () => {
    const lines = read(file).split("\n").length;
    assert.ok(
      lines < 60,
      `${file} is ${lines} lines — it is becoming a copy of AGENTS.md. Keep it a pointer; put the content in AGENTS.md where every agent reads it.`,
    );
  });

  /**
   * The invariants are the one thing worth stating twice — they gate output.
   * Newlines are collapsed first: these files are hard-wrapped, so a phrase
   * straddling a line break is still present to a reader.
   */
  test(`${agent}'s pointer file carries both invariants`, () => {
    const src = read(file).replace(/\s+/g, " ");
    assert.match(src, /[Mm]easured or nothing/, `${file} must state the measured-or-nothing rule`);
    assert.match(
      src,
      /[Aa]pproving is not shipping/,
      `${file} must state that approval is the terminus`,
    );
  });
}

/**
 * A symlink, not a copy — so GEMINI.md cannot fall out of sync by construction.
 * Checked with lstat: existsSync follows the link and would pass on a broken one.
 */
test("GEMINI.md is a live symlink to AGENTS.md", () => {
  const link = join(repoRoot, "GEMINI.md");
  assert.ok(lstatSync(link).isSymbolicLink(), "GEMINI.md must be a symlink, not a copy of AGENTS.md");
  assert.equal(
    readlinkSync(link),
    "AGENTS.md",
    "GEMINI.md must point at AGENTS.md exactly — a stray newline or path prefix makes it a dangling link that reads as an empty file",
  );
  assert.match(read("GEMINI.md"), /^# AGENTS\.md/, "GEMINI.md resolves to nothing — the link is broken");
});

/**
 * The README is where a non-Claude user actually lands. It must not present a
 * Claude-only install as the only way in.
 */
test("the README offers a vendor-neutral install path", () => {
  const readme = read("README.md");
  assert.match(
    readme,
    /git clone https:\/\/github\.com\/airowe\/store-ops/,
    "the README must show a plain clone — `/plugin marketplace add` does not exist outside Claude Code",
  );
  assert.match(
    readme,
    /AGENTS\.md/,
    "the README must point at AGENTS.md as the front door for any agent",
  );
  assert.doesNotMatch(
    readme,
    /^##\s*Install \(in Claude Code\)/m,
    "the install heading must not scope the whole project to one vendor",
  );
});

/**
 * The portability claim itself. Vendor-specific frontmatter in a SKILL.md would
 * make that skill unreadable to agents that do not understand the key.
 */
test("no skill carries vendor-specific frontmatter", () => {
  const skills = execFileSync("git", ["ls-files", "skills/*/SKILL.md"], {
    encoding: "utf8",
    cwd: repoRoot,
  })
    .split("\n")
    .filter(Boolean);

  assert.ok(skills.length > 0, "no skills found — the glob is wrong");

  const offenders = [];
  for (const file of skills) {
    const m = read(file).match(/^---\n([\s\S]*?)\n---/);
    if (!m) {
      offenders.push(`${file}: no frontmatter block`);
      continue;
    }
    for (const line of m[1].split("\n")) {
      const key = line.match(/^([a-zA-Z-]+):/)?.[1];
      if (key && key !== "name" && key !== "description") {
        offenders.push(`${file}: unexpected frontmatter key "${key}"`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `skills must carry only name/description so any agent can read them:\n  ${offenders.join("\n  ")}`,
  );
});
