/**
 * The concrete, env.AI-backed Localizer (#78 direction 1). Mirrors
 * aiReasoner.ts: this is the ONE place that touches the Workers AI binding for
 * translation, so localizeCopy stays pure and unit-testable. Returns null when
 * the binding is absent — the route then answers with the honest
 * "translation needs the AI binding" 503, never a fake deterministic
 * translation (the PRD's refusal rule).
 *
 * DeepL upgrade path: implement the same Localizer signature over the DeepL
 * REST API and swap here — nothing else changes (the PRD's B2 seam).
 */
import type { Localizer } from "../engine/localizeCopy.js";

/** Same small instruct model the keyword reasoner uses. */
const LOCALIZER_MODEL = "@cf/meta/llama-3.1-8b-instruct";

type AiLike = { run(model: string, input: unknown): Promise<unknown> };

function extractText(out: unknown): string {
  if (typeof out === "string") return out;
  if (out && typeof out === "object" && "response" in out) {
    const r = (out as { response?: unknown }).response;
    if (typeof r === "string") return r;
  }
  return "";
}

/** Strip wrapping quotes/fences the model sometimes adds around a bare line. */
function cleanLine(s: string): string {
  return s
    .trim()
    .replace(/^```[a-z]*\n?|```$/g, "")
    .trim()
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "")
    .trim();
}

const KIND_INSTRUCTION: Record<"name" | "subtitle" | "keyword" | "promo", string> = {
  name: "an App Store app NAME (marketing register, natural and concise)",
  subtitle: "an App Store SUBTITLE (marketing register, natural and concise)",
  keyword:
    "a single App Store SEARCH KEYWORD — reply with the short term a native speaker would actually type when searching",
  promo: "App Store PROMOTIONAL TEXT (marketing register, natural)",
};

export function localizerForEnv(ai: AiLike | undefined): Localizer | null {
  if (!ai) return null;
  return async ({ text, targetLocale, kind }): Promise<string> => {
    const out = await ai.run(LOCALIZER_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You are a professional App Store localization translator. Reply with " +
            "ONLY the translation — no quotes, no notes, no explanations. Preserve " +
            "any ⟦N⟧ placeholders exactly as they appear.",
        },
        {
          role: "user",
          content:
            `Translate the following, which is ${KIND_INSTRUCTION[kind]}, ` +
            `into the language of the App Store locale "${targetLocale}".\n\n${text}`,
        },
      ],
    });
    const t = cleanLine(extractText(out));
    if (!t) throw new Error("empty translation from the model");
    return t;
  };
}
