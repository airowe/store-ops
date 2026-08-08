/**
 * SVG→PNG rasterization at the posting edge.
 *
 * The proof card (`cloud/src/shareCard.ts`) is a self-contained SVG — system
 * font stack, no external refs — so it rasterizes without a browser. X wants a
 * bitmap attachment, so the posting edge (not the Worker) does the conversion:
 * `@resvg/resvg-js` runs where the post is sent, keeping the server free of
 * native/wasm rendering deps and of any X-facing responsibility.
 */
import { Resvg } from "@resvg/resvg-js";

/**
 * Render an SVG string to a PNG buffer. `scale` multiplies the SVG's native
 * size (the wide card is 1200×630; the default 2× yields a retina-crisp
 * 2400×1260). Throws on unparseable SVG rather than emitting a broken image.
 *
 * @param {string} svg
 * @param {{ scale?: number }} [opts]
 * @returns {Buffer}
 */
export function rasterizePng(svg, { scale = 2 } = {}) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    // The card's system-font stack resolves against whatever the edge machine
    // has; missing families fall back rather than fail the render.
    font: { loadSystemFonts: true },
  });
  return resvg.render().asPng();
}
