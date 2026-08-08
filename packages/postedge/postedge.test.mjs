/**
 * The bird auto-post trigger — posting-edge orchestration over the emitter
 * endpoint (`GET /apps/:id/buildinpublic-post`, merged in #445).
 *
 * Semantics under test:
 *   • The server's honesty bar is respected: 404 (no genuine win) → post
 *     NOTHING, write nothing.
 *   • A confirmed win posts ONCE — dedup by the composed text's digest, and
 *     only a SUCCESSFUL post marks state (a failed or not-yet-connected post
 *     command leaves the win eligible for retry).
 *   • The outbox (post.txt + card.png) is written before the post command runs,
 *     so `bird` receives real files.
 *
 * Pure `node --test`: injected fetch + post command, temp dirs, no network.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCliArgs, runPostEdge, winKey } from "./postedge.mjs";

const POST = {
  text: '📈 "budget tracker" for ShipASO: #40 → #12, up 28 spots.\nhttps://apps.apple.com/us/app/id123\n#BuildInPublic #Shipaton',
  hashtags: ["#BuildInPublic", "#Shipaton"],
  cardSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630"><rect width="1200" height="630" fill="#0b0e14"/></svg>',
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "postedge-"));
});

function opts(over = {}) {
  return {
    base: "https://api.example.test",
    apiKey: "shipaso_secret",
    appId: "app-1",
    storeUrl: "https://apps.apple.com/us/app/id123",
    outDir: join(dir, "out"),
    statePath: join(dir, "state.json"),
    ...over,
  };
}

test("requests the emitter with the api key and an encoded storeUrl", async () => {
  const calls = [];
  await runPostEdge(opts(), {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({}, 404);
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.example.test/apps/app-1/buildinpublic-post?storeUrl=https%3A%2F%2Fapps.apple.com%2Fus%2Fapp%2Fid123",
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer shipaso_secret");
});

test("404 (no genuine win) → no-win: nothing written, no state", async () => {
  const out = await runPostEdge(opts(), { fetchImpl: async () => jsonResponse({}, 404) });
  assert.equal(out.status, "no-win");
  await assert.rejects(access(join(dir, "out")));
  await assert.rejects(access(join(dir, "state.json")));
});

test("a non-404 API error is surfaced honestly, not swallowed", async () => {
  await assert.rejects(
    runPostEdge(opts(), { fetchImpl: async () => jsonResponse({ error: "unauthorized" }, 401) }),
    /401/,
  );
});

test("no post command → prepared: outbox written, state NOT marked", async () => {
  const out = await runPostEdge(opts(), { fetchImpl: async () => jsonResponse(POST) });
  assert.equal(out.status, "prepared");
  const text = await readFile(join(out.outboxDir, "post.txt"), "utf8");
  assert.equal(text, `${POST.text}\n`);
  const png = await readFile(join(out.outboxDir, "card.png"));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // Not marked: only a successful POST consumes the win — once bird is
  // connected, the same win must still be eligible.
  await assert.rejects(access(join(dir, "state.json")));
});

test("post command runs against the written files, then state marks the win", async () => {
  const posted = [];
  const out = await runPostEdge(opts(), {
    fetchImpl: async () => jsonResponse(POST),
    post: async (textPath, pngPath) => {
      // Files must already exist when bird is invoked.
      await access(textPath);
      await access(pngPath);
      posted.push({ textPath, pngPath });
    },
  });
  assert.equal(out.status, "posted");
  assert.equal(posted.length, 1);
  const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.equal(state.apps["app-1"].key, winKey(POST.text));
  assert.equal(state.apps["app-1"].text, POST.text);
});

test("the same confirmed win never posts twice", async () => {
  const posted = [];
  const deps = {
    fetchImpl: async () => jsonResponse(POST),
    post: async () => posted.push(1),
  };
  await runPostEdge(opts(), deps);
  const second = await runPostEdge(opts(), deps);
  assert.equal(second.status, "duplicate");
  assert.equal(posted.length, 1);
});

test("a NEW win (different composed text) posts again", async () => {
  const posted = [];
  const deps1 = { fetchImpl: async () => jsonResponse(POST), post: async () => posted.push(1) };
  await runPostEdge(opts(), deps1);
  const next = { ...POST, text: POST.text.replace("#12", "#5") };
  const deps2 = { fetchImpl: async () => jsonResponse(next), post: async () => posted.push(2) };
  const out = await runPostEdge(opts(), deps2);
  assert.equal(out.status, "posted");
  assert.deepEqual(posted, [1, 2]);
});

test("a FAILED post leaves the win unconsumed — the next run retries", async () => {
  let attempts = 0;
  const failing = {
    fetchImpl: async () => jsonResponse(POST),
    post: async () => {
      attempts++;
      throw new Error("X is down");
    },
  };
  await assert.rejects(runPostEdge(opts(), failing), /X is down/);
  await assert.rejects(access(join(dir, "state.json")));
  const retry = await runPostEdge(opts(), {
    fetchImpl: async () => jsonResponse(POST),
    post: async () => {
      attempts++;
    },
  });
  assert.equal(retry.status, "posted");
  assert.equal(attempts, 2);
});

test("outbox dirs are per-win, so a new win never clobbers the last one", async () => {
  await runPostEdge(opts(), { fetchImpl: async () => jsonResponse(POST) });
  const next = { ...POST, text: POST.text.replace("#12", "#5") };
  await runPostEdge(opts(), { fetchImpl: async () => jsonResponse(next) });
  const dirs = await readdir(join(dir, "out"));
  assert.equal(dirs.length, 2);
});

// ── CLI arg parsing (the thin shell over runPostEdge) ─────────────────────────

test("parseCliArgs: full happy path", () => {
  const parsed = parseCliArgs(
    ["--app", "app-1", "--store-url", "https://apps.apple.com/us/app/id123", "--state", "s.json", "--out", "o", "--post-cmd", "bird-post", "--journal", "docs/landing/journey"],
    { SHIPASO_API_KEY: "shipaso_k", SHIPASO_API_BASE: "https://api.example.test" },
  );
  assert.deepEqual(parsed, {
    base: "https://api.example.test",
    apiKey: "shipaso_k",
    appId: "app-1",
    storeUrl: "https://apps.apple.com/us/app/id123",
    statePath: "s.json",
    outDir: "o",
    postCmd: "bird-post",
    journalDir: "docs/landing/journey",
  });
});

test("parseCliArgs: defaults — production API, local state/outbox, no post cmd", () => {
  const parsed = parseCliArgs(
    ["--app", "app-1", "--store-url", "https://apps.apple.com/us/app/id123"],
    { SHIPASO_API_KEY: "shipaso_k" },
  );
  assert.equal(parsed.base, "https://api.shipaso.com");
  assert.equal(parsed.statePath, "postedge-state.json");
  assert.equal(parsed.outDir, "postedge-out");
  assert.equal(parsed.postCmd, null);
  assert.equal(parsed.journalDir, null);
});

test("parseCliArgs: the api key comes from the environment only, and is required", () => {
  assert.throws(
    () => parseCliArgs(["--app", "a", "--store-url", "https://x.test"], {}),
    /SHIPASO_API_KEY/,
  );
});

test("parseCliArgs: --app and an https --store-url are required", () => {
  const env = { SHIPASO_API_KEY: "k" };
  assert.throws(() => parseCliArgs(["--store-url", "https://x.test"], env), /--app/);
  assert.throws(() => parseCliArgs(["--app", "a"], env), /--store-url/);
  assert.throws(() => parseCliArgs(["--app", "a", "--store-url", "http://x.test"], env), /https/);
});
