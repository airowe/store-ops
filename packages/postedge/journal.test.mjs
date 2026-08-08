/**
 * The --journal writer: a SUCCESSFULLY posted win lands on the public /journey
 * ledger (docs/landing/journey/feed.json + its proof card PNG) — and nothing
 * else ever does. Prepared, failed, duplicate, or win-less runs write no
 * journal. The entry's numbers come from the emitter's structured `win`
 * (measured), its body is the exact posted text, and its X link exists only
 * when the post command reported one (absent, never invented).
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPostEdge } from "./postedge.mjs";

const WIN = { keyword: "budget tracker", current: 12, previous: 40, delta: -28, direction: "up" };
const POST = {
  text: '📈 "budget tracker" for ShipASO: #40 → #12, up 28 spots.\nhttps://apps.apple.com/us/app/id123\n#BuildInPublic #Shipaton',
  hashtags: ["#BuildInPublic", "#Shipaton"],
  cardSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630"><rect width="1200" height="630" fill="#0b0e14"/></svg>',
  win: WIN,
};

function jsonResponse(body, status = 200) {
  return { ok: status < 300, status, json: async () => body, text: async () => "" };
}

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "journal-"));
});

function opts(over = {}) {
  return {
    base: "https://api.example.test",
    apiKey: "shipaso_secret",
    appId: "app-1",
    storeUrl: "https://apps.apple.com/us/app/id123",
    outDir: join(dir, "out"),
    statePath: join(dir, "state.json"),
    journalDir: join(dir, "journey"),
    ...over,
  };
}

const NOW = () => new Date("2026-08-09T12:00:00Z");

async function feed() {
  return JSON.parse(await readFile(join(dir, "journey", "feed.json"), "utf8"));
}

test("a posted win is journaled: entry + copied card, measured numbers, exact text", async () => {
  const out = await runPostEdge(opts(), {
    fetchImpl: async () => jsonResponse(POST),
    post: async () => "url=https://x.com/shipaso/status/123",
    now: NOW,
  });
  assert.equal(out.status, "posted");
  assert.equal(out.journaled, true);
  const f = await feed();
  assert.equal(f.version, 1);
  assert.equal(f.entries.length, 1);
  const e = f.entries[0];
  assert.equal(e.date, "2026-08-09");
  assert.equal(e.kind, "win");
  assert.match(e.title, /budget tracker/);
  assert.match(e.title, /#40 → #12/);
  assert.equal(e.body, POST.text);
  assert.deepEqual(e.numbers, { keyword: "budget tracker", from: 40, to: 12 });
  assert.equal(e.links.x, "https://x.com/shipaso/status/123");
  assert.match(e.card, /^cards\/[0-9a-f]{12}\.png$/);
  const png = await readFile(join(dir, "journey", e.card));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
});

test("a debut journals without `from` — absent, never invented", async () => {
  const debut = {
    ...POST,
    text: POST.text.replace("#40 → #12, up 28 spots", "debuted at #12"),
    win: { keyword: "budget tracker", current: 12, previous: null, delta: null, direction: "new" },
  };
  await runPostEdge(opts(), {
    fetchImpl: async () => jsonResponse(debut),
    post: async () => undefined,
    now: NOW,
  });
  const e = (await feed()).entries[0];
  assert.deepEqual(e.numbers, { keyword: "budget tracker", to: 12 });
  assert.match(e.title, /debuted at #12/);
});

test("no url from the post command → no x link (absent, never invented)", async () => {
  await runPostEdge(opts(), {
    fetchImpl: async () => jsonResponse(POST),
    post: async () => undefined,
    now: NOW,
  });
  const e = (await feed()).entries[0];
  assert.equal(e.links, undefined);
});

test("appends to an existing feed, newest entry included alongside the old", async () => {
  await mkdir(join(dir, "journey"), { recursive: true });
  const existing = {
    version: 1,
    entries: [{ date: "2026-07-29", kind: "story", title: "Rejected", body: "Four guidelines." }],
  };
  await writeFile(join(dir, "journey", "feed.json"), JSON.stringify(existing));
  await runPostEdge(opts(), {
    fetchImpl: async () => jsonResponse(POST),
    post: async () => undefined,
    now: NOW,
  });
  const f = await feed();
  assert.equal(f.entries.length, 2);
  assert.equal(f.entries[0].kind, "story");
  assert.equal(f.entries[1].kind, "win");
});

test("the same win never journals twice, even if posting state was lost", async () => {
  const deps = { fetchImpl: async () => jsonResponse(POST), post: async () => undefined, now: NOW };
  await runPostEdge(opts(), deps);
  await rm(join(dir, "state.json")); // simulate a lost state file → re-post attempt
  await runPostEdge(opts(), deps);
  assert.equal((await feed()).entries.length, 1);
});

test("prepared (no post command) and FAILED posts journal nothing", async () => {
  await runPostEdge(opts(), { fetchImpl: async () => jsonResponse(POST), now: NOW });
  await assert.rejects(
    runPostEdge(opts(), {
      fetchImpl: async () => jsonResponse(POST),
      post: async () => {
        throw new Error("X is down");
      },
      now: NOW,
    }),
  );
  await assert.rejects(access(join(dir, "journey", "feed.json")));
});

test("a malformed feed.json is an honest error, never clobbered", async () => {
  await mkdir(join(dir, "journey"), { recursive: true });
  await writeFile(join(dir, "journey", "feed.json"), "{not json");
  await assert.rejects(
    runPostEdge(opts(), {
      fetchImpl: async () => jsonResponse(POST),
      post: async () => undefined,
      now: NOW,
    }),
    /feed\.json/,
  );
  assert.equal(await readFile(join(dir, "journey", "feed.json"), "utf8"), "{not json");
});

test("no structured win from the emitter → posted but NOT journaled (never guess numbers)", async () => {
  const { win: _omitted, ...legacy } = POST;
  const out = await runPostEdge(opts(), {
    fetchImpl: async () => jsonResponse(legacy),
    post: async () => undefined,
    now: NOW,
  });
  assert.equal(out.status, "posted");
  assert.equal(out.journaled, false);
  await assert.rejects(access(join(dir, "journey", "feed.json")));
});

test("without --journal nothing changes (opt-in)", async () => {
  const out = await runPostEdge(opts({ journalDir: null }), {
    fetchImpl: async () => jsonResponse(POST),
    post: async () => undefined,
    now: NOW,
  });
  assert.equal(out.status, "posted");
  assert.equal(out.journaled, false);
});
