/**
 * SVG→PNG rasterization at the posting edge — the slice that turns the proof
 * card (`cloud/src/shareCard.ts` renders it self-contained: no external fonts,
 * no remote refs) into the image `bird` attaches to the X post.
 *
 * The card's text uses system font stacks; on a fontless CI box the glyphs may
 * fall back or drop, so these tests assert the STRUCTURAL truth — a real PNG at
 * the exact pixel size — not pixel content.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rasterizePng } from "./rasterize.mjs";

// A faithful miniature of the real share card: gradient defs, tspans, text.
const CARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b0e14"/><stop offset="1" stop-color="#07090e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="600" y="400" text-anchor="middle" font-size="132"><tspan fill="#828ca3">#40</tspan><tspan fill="#34d399" dx="22">#12</tspan></text>
</svg>`;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width/height straight out of the IHDR chunk — no decoder dependency. */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("renders a real PNG at the card's native 1200×630 (scale 1)", () => {
  const png = rasterizePng(CARD_SVG, { scale: 1 });
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual(png.subarray(0, 8), PNG_MAGIC);
  assert.deepEqual(pngSize(png), { width: 1200, height: 630 });
});

test("default scale is 2× — a retina-crisp 2400×1260 for the timeline", () => {
  const png = rasterizePng(CARD_SVG);
  assert.deepEqual(pngSize(png), { width: 2400, height: 1260 });
});

test("rejects an unparseable SVG instead of emitting a broken image", () => {
  assert.throws(() => rasterizePng("not svg at all"));
});
