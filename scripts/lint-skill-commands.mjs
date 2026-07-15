#!/usr/bin/env node
/**
 * lint-skill-commands — verify every `asc …` / `gplay …` command a skill
 * documents actually exists in the installed CLI.
 *
 * Why this exists: several shipped skills documented commands that don't exist
 * (asc beta-groups, wrong migrate flags, …). A first-time plugin user hits those
 * immediately. Ad-hoc `-h` checks are unreliable — for a two-word subcommand,
 * `asc <group> <verb> -h` prints "Unknown command" even when the command is real.
 *
 * The reliable source of truth is the SUBCOMMANDS block of each `--help` page.
 * We recurse that into a command tree, then check each skill's commands against
 * it. Existence only — this does NOT validate flags or run anything.
 *
 * Only commands inside code contexts (``` blocks or `inline`) are checked —
 * prose and headings ("# asc id resolver") are ignored. A deprecated-but-working
 * command warns (exit 0); a genuinely missing one fails (exit 1).
 *
 * Requires `asc` and/or `gplay` on PATH — it builds the command tree from their
 * live `--help` output. If a CLI is absent, its commands are skipped (so this is
 * a LOCAL check, not a CI gate unless the runner installs the CLIs).
 *
 * Usage:
 *   node scripts/lint-skill-commands.mjs            # lint all skills/
 *   node scripts/lint-skill-commands.mjs asc-id-resolver
 * Exit code 1 if any documented command is missing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "skills");

/**
 * Run `<tool> <path...> --help` and return its text.
 *
 * NOTE: these CLIs detect a non-TTY stdout and print nothing when spawned with a
 * plain pipe (execFileSync captured 0 bytes). Going through `sh -c` with a
 * redirect matches what a real shell sees and reliably captures the help text.
 */
function help(tool, path) {
  const cmd = [tool, ...path.map((p) => `'${p}'`), "--help"].join(" ");
  try {
    return execFileSync("sh", ["-c", `${cmd} 2>&1`], { encoding: "utf8" });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "") || "";
  }
}

/**
 * Return the set of direct subcommand names available under `<tool> <path>`.
 *
 * These CLIs list subcommands two ways, and different pages use different ones:
 *   (a) a name/description table under a SUBCOMMANDS / *COMMANDS header:
 *          "  list   List builds."
 *   (b) usage-example lines that spell out the full path:
 *          "  asc builds list --app …"
 * We harvest both. For (b) the subcommand is the token at position len(path)+1
 * in a line that starts with the tool and our current path.
 */
function subcommands(text, tool, path) {
  if (!text) return new Set();
  const out = new Set();
  const prefix = [tool, ...path].join(" ");
  let inBlock = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    // (b) usage lines like "  asc builds list …"
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix + " ")) {
      const rest = trimmed.slice(prefix.length).trim().split(/\s+/);
      const tok = rest[0];
      if (tok && /^[a-z][a-z0-9-]+$/.test(tok) && tok !== "<subcommand>") out.add(tok);
      continue;
    }
    // (a) name/description table
    if (/^[A-Z][A-Z &]*COMMANDS?\b/.test(line) || /^SUBCOMMANDS\b/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && /^[A-Z]/.test(line)) inBlock = false;
    // "  name   Description"  OR  "  name:  Description"  (top-level asc uses a colon)
    const m = inBlock && line.match(/^ {2,}([a-z][a-z0-9-]+):?\s{2,}\S/);
    if (m) out.add(m[1]);
  }
  return out;
}

/** Is this (tool, path) command deprecated? (its help says so) */
function isDeprecated(text) {
  return /\bDEPRECATED\b/i.test((text || "").split("\n").slice(0, 4).join("\n"));
}

/**
 * Resolve a documented command path against the real CLI tree, walking as deep
 * as the tokens go. Returns { ok, deprecated, resolved, failedAt }.
 */
const cache = new Map();
function resolve(tool, tokens) {
  let path = [];
  let deprecated = false;
  for (const tok of tokens) {
    const key = tool + " " + path.join(" ");
    let kids = cache.get(key);
    if (kids === undefined) {
      const text = help(tool, path);
      kids = subcommands(text, tool, path);
      cache.set(key, kids);
    }
    if (!kids.has(tok)) {
      // Not in the parsed tree — but deprecated commands are often HIDDEN from the
      // parent's listing while still working. Probe directly before failing.
      const probe = help(tool, [...path, tok]);
      const real = /^\s*DESCRIPTION\b/m.test(probe) && !/^Unknown command/m.test(probe);
      if (!real) return { ok: false, failedAt: [...path, tok].join(" ") };
      if (isDeprecated(probe)) deprecated = true;
      path.push(tok);
      continue;
    }
    path.push(tok);
    const leafText = help(tool, path);
    if (isDeprecated(leafText)) deprecated = true;
  }
  return { ok: true, deprecated, resolved: path.join(" ") };
}

/**
 * Extract (tool, [tokens]) command invocations from a skill's markdown — ONLY
 * from code contexts (fenced ``` blocks and inline `backticks`). A command in
 * running prose or a heading ("# asc id resolver") is not an instruction to run
 * anything, and scraping those produces false positives.
 */
function extractCommands(md) {
  const codeSpans = [];
  // fenced blocks
  for (const m of md.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) codeSpans.push(m[1]);
  // inline code
  for (const m of md.matchAll(/`([^`\n]+)`/g)) codeSpans.push(m[1]);

  const cmds = [];
  const re = /\b(asc|gplay)((?:\s+[a-z][a-z0-9-]+)+)/g;
  for (const span of codeSpans) {
    for (const m of span.matchAll(re)) {
      const toks = m[2].trim().split(/\s+/);
      cmds.push({ tool: m[1], tokens: toks, raw: `${m[1]} ${toks.join(" ")}` });
    }
  }
  return cmds;
}

function toolPresent(tool) {
  try {
    execFileSync("which", [tool], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
const only = process.argv[2];
const dirs = readdirSync(SKILLS).filter(
  (d) => existsSync(join(SKILLS, d, "SKILL.md")) && (!only || d === only),
);

const present = { asc: toolPresent("asc"), gplay: toolPresent("gplay") };
if (!present.asc) console.warn("⚠  asc not installed — skipping asc commands");
if (!present.gplay) console.warn("⚠  gplay not installed — skipping gplay commands");

let missing = 0;
let deprecated = 0;
const skipped = new Set();

for (const d of dirs) {
  const md = readFileSync(join(SKILLS, d, "SKILL.md"), "utf8");
  const cmds = extractCommands(md);
  const problems = [];
  const seen = new Set();
  for (const c of cmds) {
    if (seen.has(c.raw)) continue;
    seen.add(c.raw);
    if (!present[c.tool]) {
      skipped.add(c.tool);
      continue;
    }
    // Trim trailing tokens greedily: the deepest valid prefix is the command;
    // remaining tokens are usually values, not subcommands. Try longest→shortest.
    let best = null;
    for (let n = c.tokens.length; n >= 1; n--) {
      const r = resolve(c.tool, c.tokens.slice(0, n));
      if (r.ok) {
        best = r;
        break;
      }
    }
    if (!best) problems.push({ raw: c.raw, kind: "missing" });
    else if (best.deprecated) problems.push({ raw: c.raw, kind: "deprecated", resolved: best.resolved });
  }
  if (problems.length) {
    console.log(`\n${d}:`);
    for (const p of problems) {
      if (p.kind === "missing") {
        console.log(`  ✗ MISSING   ${p.raw}`);
        missing++;
      } else {
        console.log(`  ⚠ deprecated ${p.raw}  (→ ${p.resolved} is deprecated)`);
        deprecated++;
      }
    }
  }
}

console.log(
  `\n${missing} missing command(s), ${deprecated} deprecated across ${dirs.length} skill(s).`,
);
if (skipped.size) console.log(`(skipped ${[...skipped].join(", ")} — CLI not installed)`);
process.exit(missing > 0 ? 1 : 0);
