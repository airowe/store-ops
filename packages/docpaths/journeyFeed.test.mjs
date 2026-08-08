import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * The /journey feed is the public evidence ledger — every entry claims
 * something REALLY happened. This guard is what makes a hand-edited (and
 * postedge-appended) JSON file safe to publish:
 *
 *   • dates are real ISO days, never in the future,
 *   • a referenced proof card must exist on disk (a broken card image is a
 *     wrong statement about our own receipts),
 *   • `numbers` is measured-or-absent — and a `win` entry MUST carry it,
 *     because a win without numbers is a brag without a receipt,
 *   • links are https.
 *
 * Schema and rationale: docs/superpowers/plans/2026-08-08-shipaso-journey-page.md.
 */
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const journeyDir = join(repoRoot, "docs/landing/journey");
const feed = JSON.parse(readFileSync(join(journeyDir, "feed.json"), "utf8"));

const KINDS = new Set(["win", "story", "buildlog", "milestone"]);

test("feed has the expected shape", () => {
  assert.equal(feed.version, 1);
  assert.ok(Array.isArray(feed.entries));
  assert.ok(feed.entries.length > 0, "an empty ledger should not ship a feed file at all");
});

test("every entry: real past ISO date, known kind, title + body", () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const e of feed.entries) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `bad date: ${e.date}`);
    assert.ok(e.date <= today, `future-dated entry: ${e.date} — the ledger records, it never predicts`);
    assert.ok(KINDS.has(e.kind), `unknown kind: ${e.kind}`);
    assert.ok(typeof e.title === "string" && e.title.trim(), "title required");
    assert.ok(typeof e.body === "string" && e.body.trim(), "body required");
  }
});

test("every referenced proof card exists on disk", () => {
  for (const e of feed.entries) {
    if (e.card === undefined) continue;
    assert.match(e.card, /^cards\/[\w-]+\.png$/, `card must be a local cards/ path: ${e.card}`);
    assert.ok(existsSync(join(journeyDir, e.card)), `missing card asset: ${e.card}`);
  }
});

test("numbers are measured-or-absent, and a win always has its receipt", () => {
  for (const e of feed.entries) {
    if (e.kind === "win") {
      assert.ok(e.numbers, `win entry "${e.title}" has no numbers — a brag without a receipt`);
    }
    if (e.numbers === undefined) continue;
    assert.ok(typeof e.numbers.keyword === "string" && e.numbers.keyword.trim());
    assert.ok(Number.isInteger(e.numbers.to) && e.numbers.to > 0);
    // `from` is absent for a debut (there was no prior rank to measure) —
    // absent, never invented. When present it must be a real, different rank.
    if (e.numbers.from !== undefined) {
      assert.ok(Number.isInteger(e.numbers.from) && e.numbers.from > 0);
      assert.notEqual(e.numbers.from, e.numbers.to, "from === to is a hold, not a win");
    }
  }
});

test("every link is https", () => {
  for (const e of feed.entries) {
    for (const [name, url] of Object.entries(e.links ?? {})) {
      assert.match(String(url), /^https:\/\//, `${name} link must be https: ${url}`);
    }
  }
});
