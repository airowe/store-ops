/**
 * skiaShotRenderer — the THIN executor for a ShotRender (src/lib/shotRender.ts):
 * every decision (geometry, colors, wrapping, honesty) is made in the pure
 * module; this file only turns those decisions into Skia draw calls and PNG
 * bytes. Runs fully offscreen — no component tree, works at full store
 * resolution regardless of the phone's screen.
 *
 * The DRAFT watermark for needsReview renders here (the executor is the last
 * chance to make an un-reviewed draft visibly a draft — same rule as
 * render_locale's stamp).
 */
import { Skia, matchFont } from "@shopify/react-native-skia";
import { fitText, LINE_HEIGHT, type RGB, type ShotRender } from "./shotRender.js";

const WATERMARK = "DRAFT — review before shipping";

function skColor([r, g, b]: RGB, alpha = 1): ReturnType<typeof Skia.Color> {
  return Skia.Color(`rgba(${r}, ${g}, ${b}, ${alpha})`);
}

function fontAt(size: number) {
  return matchFont({ fontFamily: "Helvetica", fontSize: size, fontWeight: "bold" });
}

/** Rendered width of `text` at `fontSize` using the real glyphs. */
function measure(text: string, fontSize: number): number {
  return fontAt(fontSize).measureText(text).width;
}

/**
 * Draw one ShotRender to base64 PNG at its stated canvas size. Returns null
 * when the surface can't be created or a frame can't be decoded (a failed
 * render is a stated failure, never a partial image).
 */
export async function renderShotToBase64(render: ShotRender): Promise<string | null> {
  const surface = Skia.Surface.MakeOffscreen(render.canvasWidth, render.canvasHeight);
  if (!surface) return null;
  const canvas = surface.getCanvas();

  // 1) the known solid background (accents were measured against exactly this)
  const bg = Skia.Paint();
  bg.setColor(skColor(render.background));
  canvas.drawRect({ x: 0, y: 0, width: render.canvasWidth, height: render.canvasHeight }, bg);

  // 2) the captured frame, contain-fit into the device rect (never distorted)
  if (render.frameUri) {
    const data = await Skia.Data.fromURI(render.frameUri);
    const image = data ? Skia.Image.MakeImageFromEncoded(data) : null;
    if (!image) return null; // a frame we can't decode is a failed render, not a blank one
    const scale = Math.min(render.deviceRect.width / image.width(), render.deviceRect.height / image.height());
    const w = Math.max(1, Math.round(image.width() * scale));
    const h = Math.max(1, Math.round(image.height() * scale));
    const x = render.deviceRect.x + Math.floor((render.deviceRect.width - w) / 2);
    const y = render.deviceRect.y + Math.floor((render.deviceRect.height - h) / 2);
    canvas.drawImageRect(
      image,
      { x: 0, y: 0, width: image.width(), height: image.height() },
      { x, y, width: w, height: h },
      Skia.Paint(),
    );
  }

  // 3) captions — wrap/fit decisions from the pure module, real glyph widths
  for (const t of render.texts) {
    const { fontSize, lines } = fitText(t.text, t.rect, t.baseFontSize, measure);
    const font = fontAt(fontSize);
    const paint = Skia.Paint();
    paint.setColor(skColor(t.color));
    let y = t.rect.y + fontSize; // first baseline
    for (const line of lines) {
      const w = font.measureText(line).width;
      const x =
        t.align === "center"
          ? t.rect.x + (t.rect.width - w) / 2
          : t.align === "right"
            ? t.rect.x + t.rect.width - w
            : t.rect.x;
      canvas.drawText(line, x, y, paint, font);
      y += fontSize * LINE_HEIGHT;
    }
  }

  // 4) the DRAFT stamp — an un-reviewed draft is visibly a draft
  if (render.needsReview) {
    const size = Math.max(24, Math.round(render.canvasWidth * 0.028));
    const font = fontAt(size);
    const paint = Skia.Paint();
    paint.setColor(skColor([251, 191, 36], 0.9));
    canvas.drawText(WATERMARK, Math.round(render.canvasWidth * 0.04), render.canvasHeight - size, paint, font);
  }

  const image = surface.makeImageSnapshot();
  return image.encodeToBase64() ?? null;
}
