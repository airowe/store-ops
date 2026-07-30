import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSparkGeometry, classifyDelta, formatRank, humanizeStatus, timeAgo } from "./index.mjs";

test("formatRank: unmeasured is an em-dash, never 0", () => {
  assert.equal(formatRank(null), "—");
  assert.equal(formatRank(undefined), "—");
  assert.equal(formatRank(3), "#3");
});

test("humanizeStatus: approved-ready copy title-cases honestly", () => {
  assert.equal(humanizeStatus("awaiting_approval"), "Awaiting approval");
});

test("timeAgo: buckets, with raw fallback for garbage", () => {
  const now = Date.parse("2026-07-05T12:00:00Z");
  assert.equal(timeAgo("2026-07-05T11:59:30Z", now), "just now");
  assert.equal(timeAgo("2026-07-05T11:30:00Z", now), "30m ago");
  assert.equal(timeAgo("not-a-date", now), "not-a-date");
});

test("classifyDelta: inverted axis + no fabricated count-up", () => {
  assert.deepEqual(classifyDelta({ previous: 20, current: 8 }), { direction: "up", delta: 12 });
  assert.deepEqual(classifyDelta({ previous: 8, current: 20 }), { direction: "down", delta: -12 });
  assert.deepEqual(classifyDelta({ previous: 5, current: 5 }), { direction: "same", delta: 0 });
  assert.deepEqual(classifyDelta({ previous: null, current: 9 }), { direction: "new", delta: null });
});

/**
 * "Fell out" and "never checked" are DIFFERENT facts and must not collapse (#360).
 *
 * Both have `current: null`, so classifying on that alone reported "unmeasured"
 * for a keyword we had measured at #9 the week before and measured again this
 * week — finding it gone. That is a measured, meaningful, bad-news event, and
 * reporting it as "we didn't look" understates it.
 *
 * The distinguishing fact is `previous`: if we have a previous rank, the term
 * WAS ranked and now is not.
 */
test("classifyDelta: a keyword that drops out of the top 200 is 'lost', not 'unmeasured'", () => {
  assert.deepEqual(classifyDelta({ previous: 9, current: null }), { direction: "lost", delta: null });
  // No previous rank → we genuinely have nothing to compare, so it stays honest.
  assert.deepEqual(classifyDelta({ previous: null, current: null }), { direction: "unmeasured", delta: null });
  assert.deepEqual(classifyDelta({ previous: undefined, current: null }), { direction: "unmeasured", delta: null });
  // Never a fabricated count-up: a lost keyword has no numeric delta.
  assert.equal(classifyDelta({ previous: 1, current: null }).delta, null);
});

test("buildSparkGeometry: honest empties, inverted axis, #200+ floor", () => {
  const box = { width: 600, height: 120, pad: 24 };
  assert.equal(buildSparkGeometry([], box).empty, true);
  assert.equal(buildSparkGeometry([{ rank: 5 }], box).empty, true);

  const geo = buildSparkGeometry([{ rank: 50 }, { rank: 1 }], box);
  assert.equal(geo.empty, false);
  assert.ok(geo.line.startsWith("M"));
  assert.ok(geo.area.endsWith("Z"));
  // rank 1 (better) plots higher (smaller y) than rank 50
  assert.ok(geo.dots[1].y < geo.dots[0].y);

  const withNull = buildSparkGeometry([{ rank: 30 }, { rank: null }], box);
  assert.equal(withNull.dots[withNull.dots.length - 1].label, "#200+");
});
