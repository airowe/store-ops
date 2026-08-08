/**
 * Bluesky (AT Protocol) posting — the free automated leg of the posting edge.
 * Plain XRPC over injected fetch, no SDK, no network in tests.
 *
 * The tricky parts under test:
 *   • facet byte offsets are UTF-8 BYTE ranges, and our composed text starts
 *     with an emoji and uses curly quotes — character offsets would be wrong,
 *   • the raw store URL is replaced with a short display form + a link facet
 *     (Bluesky has no t.co — a 60-char URL would eat the 300-grapheme budget),
 *   • hashtags only become clickable via tag facets,
 *   • errors are honest: bad login, oversized image, over-long text all throw
 *     with the reason — nothing is silently truncated or dropped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareRichText, postToBluesky, postUrlFromRecord } from "./bsky.mjs";

const TEXT =
  '📈 "budget tracker" for ShipASO: #40 → #12, up 28 spots.\n' +
  "Real organic App Store rank, moved by ShipASO's AI agent. https://apps.apple.com/us/app/shipaso-keyword-ranks/id6747283920\n" +
  "#BuildInPublic #Shipaton";

function byteSlice(text, start, end) {
  return Buffer.from(text, "utf8").subarray(start, end).toString("utf8");
}

test("prepareRichText: the URL becomes a short display form with a link facet to the FULL url", () => {
  const { text, facets } = prepareRichText(TEXT);
  assert.ok(!text.includes("https://"), "raw URL should be replaced by display text");
  const link = facets.find((f) => f.features[0].$type === "app.bsky.richtext.facet#link");
  assert.equal(
    link.features[0].uri,
    "https://apps.apple.com/us/app/shipaso-keyword-ranks/id6747283920",
  );
  // The facet's BYTE range must cover exactly the display text (emoji + curly
  // quotes earlier in the string shift byte offsets past character offsets).
  const covered = byteSlice(text, link.index.byteStart, link.index.byteEnd);
  assert.equal(covered, "apps.apple.com/us/app/shipas…");
});

test("prepareRichText: hashtags get tag facets with exact byte ranges", () => {
  const { text, facets } = prepareRichText(TEXT);
  const tags = facets.filter((f) => f.features[0].$type === "app.bsky.richtext.facet#tag");
  assert.deepEqual(
    tags.map((f) => f.features[0].tag),
    ["BuildInPublic", "Shipaton"],
  );
  for (const f of tags) {
    const covered = byteSlice(text, f.index.byteStart, f.index.byteEnd);
    assert.equal(covered, `#${f.features[0].tag}`);
  }
});

test("prepareRichText: shortening brings a tweet-budgeted text under Bluesky's 300 graphemes", () => {
  const { text } = prepareRichText(TEXT);
  const graphemes = [...new Intl.Segmenter().segment(text)].length;
  assert.ok(graphemes <= 300, `${graphemes} graphemes`);
});

test("prepareRichText: text with no URL and no tags passes through untouched", () => {
  const { text, facets } = prepareRichText("plain words only");
  assert.equal(text, "plain words only");
  assert.deepEqual(facets, []);
});

function fakeXrpc() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (url.includes("createSession")) {
      return { ok: true, status: 200, json: async () => ({ accessJwt: "jwt-1", did: "did:plc:abc" }), text: async () => "" };
    }
    if (url.includes("uploadBlob")) {
      return { ok: true, status: 200, json: async () => ({ blob: { $type: "blob", ref: { $link: "bafy" }, mimeType: "image/png", size: 3 } }), text: async () => "" };
    }
    if (url.includes("createRecord")) {
      return { ok: true, status: 200, json: async () => ({ uri: "at://did:plc:abc/app.bsky.feed.post/3kxyz", cid: "c" }), text: async () => "" };
    }
    throw new Error(`unexpected call: ${url}`);
  };
  return { calls, fetchImpl };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const NOW = () => new Date("2026-08-09T12:00:00Z");

test("postToBluesky: session → blob upload → post record, and the public URL comes back", async () => {
  const { calls, fetchImpl } = fakeXrpc();
  const out = await postToBluesky(
    { service: "https://bsky.social", identifier: "shipaso.bsky.social", password: "app-pass", text: TEXT, png: PNG, alt: "proof card" },
    { fetchImpl, now: NOW },
  );
  assert.equal(out.url, "https://bsky.app/profile/shipaso.bsky.social/post/3kxyz");

  assert.equal(calls.length, 3);
  const [session, upload, create] = calls;
  assert.match(session.url, /com\.atproto\.server\.createSession$/);
  assert.deepEqual(JSON.parse(session.init.body), { identifier: "shipaso.bsky.social", password: "app-pass" });

  assert.match(upload.url, /com\.atproto\.repo\.uploadBlob$/);
  assert.equal(upload.init.headers["Content-Type"], "image/png");
  assert.equal(upload.init.headers.Authorization, "Bearer jwt-1");
  assert.equal(upload.init.body, PNG);

  assert.match(create.url, /com\.atproto\.repo\.createRecord$/);
  const body = JSON.parse(create.init.body);
  assert.equal(body.repo, "did:plc:abc");
  assert.equal(body.collection, "app.bsky.feed.post");
  assert.equal(body.record.$type, "app.bsky.feed.post");
  assert.equal(body.record.createdAt, "2026-08-09T12:00:00.000Z");
  assert.ok(!body.record.text.includes("https://"), "record text uses the shortened display form");
  assert.ok(body.record.facets.length >= 3, "link + two tag facets");
  assert.equal(body.record.embed.$type, "app.bsky.embed.images");
  assert.equal(body.record.embed.images[0].alt, "proof card");
});

test("postToBluesky: a failed login is an honest error, and nothing is uploaded after it", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    return { ok: false, status: 401, json: async () => ({}), text: async () => '{"error":"AuthenticationRequired"}' };
  };
  await assert.rejects(
    postToBluesky(
      { service: "https://bsky.social", identifier: "h", password: "bad", text: "t", png: PNG, alt: "a" },
      { fetchImpl, now: NOW },
    ),
    /401/,
  );
  assert.equal(calls.length, 1);
});

test("postToBluesky: an image over Bluesky's 1MB cap fails BEFORE any network call", async () => {
  const big = Buffer.alloc(1_000_001);
  let called = 0;
  await assert.rejects(
    postToBluesky(
      { service: "https://bsky.social", identifier: "h", password: "p", text: "t", png: big, alt: "a" },
      { fetchImpl: async () => (called++, undefined), now: NOW },
    ),
    /1[.,]?0?0?0?[.,]?000|1 ?MB/i,
  );
  assert.equal(called, 0);
});

test("postToBluesky: text still over 300 graphemes AFTER shortening is refused, never truncated", async () => {
  const long = "x".repeat(301);
  let called = 0;
  await assert.rejects(
    postToBluesky(
      { service: "https://bsky.social", identifier: "h", password: "p", text: long, png: PNG, alt: "a" },
      { fetchImpl: async () => (called++, undefined), now: NOW },
    ),
    /300/,
  );
  assert.equal(called, 0);
});

test("postUrlFromRecord: derives the public bsky.app URL from the at:// uri", () => {
  assert.equal(
    postUrlFromRecord("shipaso.bsky.social", "at://did:plc:abc/app.bsky.feed.post/3kabc123"),
    "https://bsky.app/profile/shipaso.bsky.social/post/3kabc123",
  );
});
