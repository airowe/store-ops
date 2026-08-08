#!/usr/bin/env node
/**
 * bsky-post — a `--post-cmd` poster for Bluesky. Invoked by shipaso-postedge
 * as `bsky-post <post.txt> <card.png>`; posts the text + proof card and prints
 * `url=<public post url>` so the win journals with its link.
 *
 * Env (create the app password at bsky.app → Settings → App Passwords — never
 * the account password):
 *   BSKY_HANDLE        e.g. shipaso.bsky.social
 *   BSKY_APP_PASSWORD  the app password
 *   BSKY_SERVICE       optional, defaults to https://bsky.social
 *
 * Usage with the posting edge:
 *   SHIPASO_API_KEY=… BSKY_HANDLE=… BSKY_APP_PASSWORD=… \
 *     shipaso-postedge --app <id> --store-url <https://…> \
 *     --post-cmd ./packages/postedge/bsky-post.mjs --journal docs/landing/journey
 */
import { readFile } from "node:fs/promises";
import { postToBluesky } from "./bsky.mjs";

async function main() {
  const [textPath, pngPath] = process.argv.slice(2);
  if (!textPath || !pngPath) throw new Error("usage: bsky-post <post.txt> <card.png>");
  const identifier = process.env.BSKY_HANDLE;
  const password = process.env.BSKY_APP_PASSWORD;
  if (!identifier || !password) throw new Error("BSKY_HANDLE and BSKY_APP_PASSWORD must be set");

  const text = (await readFile(textPath, "utf8")).trimEnd();
  const png = await readFile(pngPath);
  const { url } = await postToBluesky({
    service: process.env.BSKY_SERVICE ?? "https://bsky.social",
    identifier,
    password,
    text,
    png,
    // The card is described honestly from the post's own first line.
    alt: `ShipASO proof card: ${text.split("\n")[0]}`,
  });
  console.log(`url=${url}`);
}

main().catch((e) => {
  console.error(`[bsky-post] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
