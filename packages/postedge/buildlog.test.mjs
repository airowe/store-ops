/**
 * Weekly build-log thread composer — #BuildInPublic engine 2 (see
 * `docs/shipaton/buildinpublic-playbook.md`). Turns the REAL merge history into
 * a ready-to-edit thread draft: cadence with receipts, never invention.
 *
 * Honesty bar: an empty week composes NOTHING (no "still cooking!" filler),
 * and titles come verbatim from the log — only trimmed, never rewritten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeBuildLogThread, parseMergeSubjects } from "./buildlog.mjs";

const LOG = [
  "feat(postedge): #BuildInPublic posting edge — SVG→PNG rasterization + bird auto-post trigger (#447)",
  "feat(cloud): #BuildInPublic engine — post composer + emitter endpoint (#445)",
  "docs(shipaton): Shipaton 2026 brief + status ledger (#446)",
  "fix(billing): checkout never offered a promotion-code field (#442)",
];

test("parseMergeSubjects: squash-merge subjects → {title, pr}", () => {
  const entries = parseMergeSubjects(LOG);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries[1], {
    title: "feat(cloud): #BuildInPublic engine — post composer + emitter endpoint",
    pr: 445,
  });
});

test("parseMergeSubjects: a direct-to-main commit keeps its title, pr null", () => {
  const [e] = parseMergeSubjects(["chore: bump version"]);
  assert.deepEqual(e, { title: "chore: bump version", pr: null });
});

test("parseMergeSubjects: blank lines are dropped", () => {
  assert.equal(parseMergeSubjects(["", "fix: x (#1)", "  "]).length, 1);
});

test("compose: header states the real count, carries the tags, then bullets", () => {
  const thread = composeBuildLogThread(parseMergeSubjects(LOG), { weekLabel: "week of Aug 4" });
  assert.ok(thread.length >= 2);
  assert.match(thread[0], /week of Aug 4/);
  assert.match(thread[0], /4 slices/);
  assert.match(thread[0], /#BuildInPublic/);
  assert.match(thread[0], /#Shipaton/);
  const body = thread.slice(1).join("\n");
  assert.match(body, /• feat\(cloud\): #BuildInPublic engine — post composer \+ emitter endpoint \(#445\)/);
  assert.match(body, /\(#442\)/);
});

test("compose: singular count reads naturally", () => {
  const thread = composeBuildLogThread(parseMergeSubjects(LOG.slice(0, 1)), { weekLabel: "w" });
  assert.match(thread[0], /1 slice shipped/);
  assert.doesNotMatch(thread[0], /1 slices/);
});

test("compose: every tweet fits X's 280-char budget", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    title: `feat(engine): slice number ${i} with a reasonably descriptive title attached to it`,
    pr: 400 + i,
  }));
  const thread = composeBuildLogThread(many, { weekLabel: "week of Aug 4" });
  for (const tweet of thread) assert.ok(tweet.length <= 280, `${tweet.length} > 280`);
  // …and nothing was silently dropped.
  const joined = thread.join("\n");
  for (const e of many) assert.match(joined, new RegExp(`\\(#${e.pr}\\)`));
});

test("compose: a single over-long title is trimmed with an ellipsis, never dropped", () => {
  const entry = { title: "feat: " + "x".repeat(400), pr: 7 };
  const thread = composeBuildLogThread([entry], { weekLabel: "w" });
  const bullet = thread[1];
  assert.ok(bullet.length <= 280);
  assert.match(bullet, /…/);
  assert.match(bullet, /\(#7\)/);
});

test("compose: bullets preserve log order (newest first, as git emits)", () => {
  const thread = composeBuildLogThread(parseMergeSubjects(LOG), { weekLabel: "w" });
  const body = thread.slice(1).join("\n");
  assert.ok(body.indexOf("#447") < body.indexOf("#442"));
});

test("compose: an empty week composes NOTHING", () => {
  assert.deepEqual(composeBuildLogThread([], { weekLabel: "w" }), []);
});
