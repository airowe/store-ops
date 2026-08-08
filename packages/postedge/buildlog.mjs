#!/usr/bin/env node
/**
 * Weekly #BuildInPublic build-log thread, drafted from the REAL merge history —
 * engine 2 in `docs/shipaton/buildinpublic-playbook.md`. Cadence is the hardest
 * judging axis to sustain by hand; this makes the floor automatic: run it, edit
 * for voice, post.
 *
 *   node buildlog.mjs [--since "7 days ago"] [--ref origin/main] [--week "week of Aug 4"]
 *
 * Honesty bar: titles are quoted from the log (trimmed, never rewritten), the
 * count is the real count, and an empty week drafts NOTHING — no filler.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TWEET_MAX = 280;
const HASHTAGS = "#BuildInPublic #Shipaton";

/**
 * Parse `git log --first-parent --pretty=%s` lines. Squash merges end in
 * " (#NNN)" — split that off as the PR number; anything else keeps pr: null.
 *
 * @param {string[]} lines
 * @returns {Array<{ title: string, pr: number | null }>}
 */
export function parseMergeSubjects(lines) {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((subject) => {
      const m = subject.match(/^(.*) \(#(\d+)\)$/);
      return m ? { title: m[1], pr: Number(m[2]) } : { title: subject, pr: null };
    });
}

/** One bullet line, trimmed (with an ellipsis) if it alone would overflow a tweet. */
function bullet(entry) {
  const suffix = entry.pr === null ? "" : ` (#${entry.pr})`;
  let title = entry.title;
  if (`• ${title}${suffix}`.length > TWEET_MAX) {
    title = `${title.slice(0, TWEET_MAX - suffix.length - 3).trimEnd()}…`;
  }
  return `• ${title}${suffix}`;
}

/**
 * Compose the thread: a header tweet (real count + tags), then bullets packed
 * into as few ≤280-char tweets as they need, in log order. An empty week → [].
 *
 * @param {Array<{ title: string, pr: number | null }>} entries
 * @param {{ weekLabel: string }} opts
 * @returns {string[]}
 */
export function composeBuildLogThread(entries, { weekLabel }) {
  if (entries.length === 0) return [];
  const n = entries.length;
  const header =
    `🚢 ShipASO build log — ${weekLabel}: ${n} slice${n === 1 ? "" : "s"} shipped.\n` +
    `An AI agent, building an ASO agent, in public. 🧵\n${HASHTAGS}`;

  const tweets = [header];
  let current = "";
  for (const entry of entries) {
    const line = bullet(entry);
    const next = current === "" ? line : `${current}\n${line}`;
    if (next.length > TWEET_MAX) {
      tweets.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current !== "") tweets.push(current);
  return tweets;
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const since = flag("since", "7 days ago");
  const ref = flag("ref", "HEAD");
  const week = flag("week", `since ${since}`);

  const out = execFileSync(
    "git",
    ["log", "--first-parent", `--since=${since}`, "--pretty=%s", ref],
    { encoding: "utf8" },
  );
  const thread = composeBuildLogThread(parseMergeSubjects(out.split("\n")), { weekLabel: week });
  if (thread.length === 0) {
    console.log(`[buildlog] nothing merged ${week} — post nothing.`);
    return;
  }
  console.log(thread.join("\n\n---\n\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
