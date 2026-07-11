/**
 * The concrete, env.AI-backed CaptionAnalyzer (#182 Phase 1). This is the ONE
 * place that touches the Cloudflare Workers AI VISION binding — kept out of the
 * engine so the caption lens (captionLens.ts) stays pure and unit-testable with
 * a fake analyzer.
 *
 * `captionAnalyzerForEnv` returns a `CaptionAnalyzer` (image URL → measured
 * caption + heuristic style) ONLY when BOTH are true:
 *   • the CAPTION_OCR_ENABLED opt-in flag is set — vision inference costs money
 *     and reads the user's screenshot, so it stays dark until deliberately on,
 *   • the AI binding exists (env.AI).
 * Otherwise undefined, so the run path attaches no caption findings. A missing
 * binding, a flag-off, an unfetchable image, or a garbled model reply NEVER
 * breaks a run — every failure degrades to `null` (measured-or-absent).
 *
 * The caption text we return is OCR'd from the user's real screenshot and quoted
 * verbatim downstream — it is MEASURED, never invented. Only the outcome-vs-
 * feature STYLE is a heuristic, and captionLens labels it as one.
 */
import type { CaptionAnalysis, CaptionAnalyzer } from "../engine/captionLens.js";

/** The vision model: reads the image + returns text. Small, multimodal, cheap. */
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

/** Minimal structural type for the AI binding (avoids coupling to the model list). */
type AiLike = { run(model: string, input: unknown): Promise<unknown> };

/** Narrow fetch slice we need — just enough to pull the image bytes. */
type FetchLike = (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Truthy flag parse for opt-in env switches (mirrors api/index.ts isFlagOn). */
function flagOn(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true";
}

const PROMPT =
  "You are an App Store Optimization analyst reading the FIRST screenshot of an " +
  "iOS app. Read its main headline/caption text (the large marketing line, NOT " +
  "the app UI text). Then classify whether that headline leads with an OUTCOME " +
  "(the result or transformation the user gets) or a FEATURE (what the app does " +
  "or has). Respond with ONLY a JSON object, no prose, no markdown fences: " +
  '{"caption": "<the headline text, verbatim>", "style": "outcome" | "feature" | "unclear"}. ' +
  'Use "unclear" if you cannot confidently read a headline.';

/**
 * Pull the model's text out of a Workers AI vision response. The shape is
 * `{ response: string }`, read defensively so an SDK change can't throw in-run.
 */
function extractText(out: unknown): string {
  if (typeof out === "string") return out;
  if (out && typeof out === "object" && "response" in out) {
    const r = (out as { response?: unknown }).response;
    if (typeof r === "string") return r;
  }
  return "";
}

/**
 * Parse the model's JSON reply into a CaptionAnalysis, or null if it isn't a
 * usable shape. Tolerates a leading/trailing prose wrapper by extracting the
 * first {...} block. An unreadable ("unclear") or empty caption → null so the
 * lens emits nothing (measured-or-absent, never a fabricated flag).
 */
export function parseCaptionReply(text: string): CaptionAnalysis | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const caption = (obj as { caption?: unknown }).caption;
  const style = (obj as { style?: unknown }).style;
  if (typeof caption !== "string" || caption.trim() === "") return null;
  if (style !== "outcome" && style !== "feature" && style !== "unclear") return null;
  return { caption: caption.trim(), style };
}

/**
 * Build a CaptionAnalyzer over the env.AI binding, or undefined when the OCR flag
 * is off or no binding is present. The analyzer fetches the screenshot bytes,
 * runs the vision model, and parses the reply. Any failure (bad fetch, model
 * error, unparseable reply) resolves to null — it never throws into the run path.
 */
export function captionAnalyzerForEnv(
  env: { AI?: AiLike; CAPTION_OCR_ENABLED?: string },
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): CaptionAnalyzer | undefined {
  if (!flagOn(env.CAPTION_OCR_ENABLED)) return undefined;
  const ai = env.AI;
  if (!ai) return undefined;
  return async (imageUrl: string): Promise<CaptionAnalysis | null> => {
    try {
      const resp = await fetchFn(imageUrl);
      if (!resp.ok) return null;
      const bytes = [...new Uint8Array(await resp.arrayBuffer())];
      if (bytes.length === 0) return null;
      const out = await ai.run(VISION_MODEL, { image: bytes, prompt: PROMPT, max_tokens: 256 });
      return parseCaptionReply(extractText(out));
    } catch {
      return null;
    }
  };
}
