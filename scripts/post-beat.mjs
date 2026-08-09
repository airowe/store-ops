#!/usr/bin/env node
/**
 * post-beat — post one #BuildInPublic beat (text file + PNG) to Bluesky over
 * the same tested postedge lib the automated win poster uses. For the manual
 * story beats; wins keep their own pipeline (postedge --journal / bsky-post).
 *
 * Usage (from repo root):
 *   BSKY_HANDLE=shipaso.com BSKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
 *   node scripts/post-beat.mjs \
 *     --text marketing/social/2026-08-09/beats/beat-1.txt \
 *     --image marketing/social/2026-08-09/journey-ledger.png \
 *     --alt "Timeline of the ShipASO build journey"
 *
 * Prints `url=https://bsky.app/...` on success. Refuses (never truncates) a
 * text over 300 graphemes or an image over Bluesky's 1MB blob cap.
 */
import { readFileSync } from "node:fs";
import { postToBluesky } from "../packages/postedge/bsky.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const textFile = arg("text");
const imageFile = arg("image");
const alt = arg("alt");
const identifier = process.env.BSKY_HANDLE;
const password = process.env.BSKY_APP_PASSWORD;

if (!textFile || !imageFile || !alt || !identifier || !password) {
  console.error(
    "usage: BSKY_HANDLE=... BSKY_APP_PASSWORD=... node scripts/post-beat.mjs " +
      "--text <file.txt> --image <file.png> --alt \"<image description>\"",
  );
  process.exit(2);
}

const { url } = await postToBluesky({
  service: process.env.BSKY_SERVICE ?? "https://bsky.social",
  identifier,
  password,
  text: readFileSync(textFile, "utf8").trim(),
  png: readFileSync(imageFile),
  alt,
});
console.log(`url=${url}`);
