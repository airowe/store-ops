/**
 * The concrete, env.AI-backed IconAnalyzer (#455). This is the ONE place that
 * touches the Workers AI vision binding for ARTWORK — kept out of the engine so
 * `iconDistinctiveness.ts` stays pure and unit-testable with a fake analyzer.
 *
 * `iconAnalyzerForEnv` returns an `IconAnalyzer` (artwork URL → measured
 * composition) ONLY when BOTH are true:
 *   • the ICON_VISION_ENABLED opt-in flag is set,
 *   • the AI binding exists (env.AI).
 * Otherwise undefined, so the run path attaches no icon finding.
 *
 * Cost shape differs from the caption lens, and that drove the design. The
 * caption analyzer reads ONE image per run; an icon comparison is only meaningful
 * against a neighbour set, so this reads N+1 (yours plus every competitor). Two
 * consequences are built in rather than left to callers:
 *   • `analyzeIconSet` bounds a batch to MAX_ICONS_PER_RUN inferences,
 *   • repeated URLs inside one batch are read once and reused (chart feeds and
 *     competitor sets overlap), which is a pure saving with no honesty cost —
 *     the same artwork cannot measure differently.
 *
 * Every failure degrades to `null`: a missing binding, flag-off, unfetchable
 * artwork, oversized bytes, or a garbled reply. An unread icon is UNMEASURED,
 * never defaulted to a composition — `iconDistinctivenessFindings` then sees a
 * smaller neighbour set and falls silent rather than comparing against a guess.
 */
import type { IconComposition, IconAnalyzer } from "../engine/iconDistinctiveness.js";

/** The vision model — same small multimodal model the caption lens uses. */
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

/**
 * Max artwork bytes we'll spread into a number[] for the model. Icons are far
 * smaller than screenshots (artworkUrl512 is a 512px PNG), so this is tighter
 * than the caption lens's 5MB — anything larger is not an icon we recognise.
 */
const MAX_IMAGE_BYTES = 1024 * 1024;

/**
 * Hard ceiling on inferences per batch. A top-10 comparison plus your own icon
 * is 11; this leaves headroom without letting a caller fan out unbounded.
 */
export const MAX_ICONS_PER_RUN = 12;

/** Minimal structural type for the AI binding (avoids coupling to the model list). */
type AiLike = { run(model: string, input: unknown): Promise<unknown> };

/** Narrow fetch slice we need — just enough to pull the artwork bytes. */
type FetchLike = (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Truthy flag parse for opt-in env switches (mirrors api/index.ts isFlagOn). */
function flagOn(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true";
}

/**
 * The prompt asks for OBSERVABLE COMPOSITION, not quality or appeal. "Is this a
 * good icon" is a judgement we would be laundering through a model and then
 * presenting as measurement; "is there one dominant centred shape" is a fact
 * about the image that a human could check and disagree with. The finding's
 * heuristic layer lives in the engine, where it is labelled as one.
 *
 * Thumbnail framing is explicit because that is the size the finding reasons
 * about — an icon's search-results legibility, not its detail at 512px.
 */
const PROMPT =
  "You are looking at an iOS app icon as it would appear at small size in App " +
  "Store search results. Describe only what is OBSERVABLE about its composition. " +
  "Do NOT judge whether it is attractive, professional, or effective. " +
  'Respond with ONLY a JSON object, no prose, no markdown fences: ' +
  '{"layout": "single_centred_shape" | "other", "hasText": true | false}. ' +
  'Use "single_centred_shape" when ONE dominant form sits centred on a plain or ' +
  'gradient background. Use "other" for repeated elements, scattered elements, ' +
  'edge-to-edge scenes, or photographic content. Set hasText true only if ' +
  "letters or words are legible at thumbnail size.";

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
 * Parse the model's JSON reply into an IconComposition, or null if it isn't a
 * usable shape. Tolerates a prose/markdown wrapper by extracting the first {...}
 * block.
 *
 * Both fields are REQUIRED. A reply missing `hasText`, or carrying a non-boolean
 * for it, is rejected rather than defaulted to false — defaulting would invent a
 * measurement, and an unmeasured icon must drop out of the set instead.
 */
export function parseIconReply(text: string): IconComposition | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const layout = (obj as { layout?: unknown }).layout;
  const hasText = (obj as { hasText?: unknown }).hasText;
  if (layout !== "single_centred_shape" && layout !== "other") return null;
  if (typeof hasText !== "boolean") return null;
  return { layout, hasText };
}

/**
 * Build an IconAnalyzer over the env.AI binding, or undefined when the flag is
 * off or no binding is present. Any failure resolves to null — it never throws
 * into the run path.
 */
export function iconAnalyzerForEnv(
  env: { AI?: AiLike; ICON_VISION_ENABLED?: string },
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): IconAnalyzer | undefined {
  if (!flagOn(env.ICON_VISION_ENABLED)) return undefined;
  const ai = env.AI;
  if (!ai) return undefined;
  return async (artworkUrl: string): Promise<IconComposition | null> => {
    try {
      const resp = await fetchFn(artworkUrl);
      if (!resp.ok) return null;
      const buf = await resp.arrayBuffer();
      // Bound the read the same way the caption lens does: over the cap → degrade
      // to null rather than spike the heap of a 128MB Worker.
      if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
      const bytes = [...new Uint8Array(buf)];
      const out = await ai.run(VISION_MODEL, { image: bytes, prompt: PROMPT, max_tokens: 128 });
      return parseIconReply(extractText(out));
    } catch {
      return null;
    }
  };
}

/**
 * Read a whole icon set under one inference budget, de-duplicating by URL.
 *
 * Wraps an IconAnalyzer rather than replacing `readIcons` in the engine: that
 * function stays pure and knows nothing about budgets, while the cost policy
 * lives here with the thing that spends the money.
 *
 * Beyond `limit` inferences the remaining icons are returned UNMEASURED (null),
 * not dropped silently and not guessed — the caller's set shrinks and the
 * finding falls silent on its own, which is the behaviour we want at the edge of
 * a budget.
 */
export async function analyzeIconSet(
  analyzer: IconAnalyzer,
  urls: (string | null | undefined)[],
  limit: number = MAX_ICONS_PER_RUN,
): Promise<(IconComposition | null)[]> {
  const seen = new Map<string, IconComposition | null>();
  const out: (IconComposition | null)[] = [];
  let spent = 0;
  for (const url of urls) {
    if (!url) {
      out.push(null);
      continue;
    }
    if (seen.has(url)) {
      out.push(seen.get(url) ?? null);
      continue;
    }
    if (spent >= limit) {
      out.push(null);
      continue;
    }
    spent += 1;
    let composition: IconComposition | null = null;
    try {
      composition = await analyzer(url);
    } catch {
      composition = null;
    }
    seen.set(url, composition);
    out.push(composition);
  }
  return out;
}
