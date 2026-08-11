import { describe, expect, it, vi } from "vitest";
import {
  MAX_ICONS_PER_RUN,
  analyzeIconSet,
  iconAnalyzerForEnv,
  parseIconReply,
} from "./aiIconVision.js";
import type { IconComposition } from "../engine/iconDistinctiveness.js";

const CENTRED: IconComposition = { layout: "single_centred_shape", hasText: false };

const okFetch = (bytes = [1, 2, 3, 4]) =>
  vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(bytes).buffer }));

const reply = (json: string) => ({
  run: vi.fn(async (_model: string, _input: unknown) => ({ response: json })),
});

describe("parseIconReply", () => {
  it("parses a clean JSON object", () => {
    expect(parseIconReply('{"layout":"single_centred_shape","hasText":false}')).toEqual(CENTRED);
  });

  it("tolerates prose/markdown around the JSON", () => {
    const text = 'Sure:\n```json\n{"layout":"other","hasText":true}\n```';
    expect(parseIconReply(text)).toEqual({ layout: "other", hasText: true });
  });

  it("returns null on non-JSON or an unknown layout", () => {
    expect(parseIconReply("no json here")).toBeNull();
    expect(parseIconReply("{not valid json}")).toBeNull();
    expect(parseIconReply('{"layout":"vibes","hasText":false}')).toBeNull();
    expect(parseIconReply('{"hasText":false}')).toBeNull();
  });

  it("rejects a missing or non-boolean hasText rather than defaulting it", () => {
    // Defaulting would invent a measurement; an unmeasured icon must drop out.
    expect(parseIconReply('{"layout":"other"}')).toBeNull();
    expect(parseIconReply('{"layout":"other","hasText":"yes"}')).toBeNull();
    expect(parseIconReply('{"layout":"other","hasText":null}')).toBeNull();
  });
});

describe("iconAnalyzerForEnv gating", () => {
  const ai = reply('{"layout":"single_centred_shape","hasText":false}');

  it("returns undefined when the flag is off (even with a binding)", () => {
    expect(iconAnalyzerForEnv({ AI: ai }, okFetch())).toBeUndefined();
    expect(iconAnalyzerForEnv({ AI: ai, ICON_VISION_ENABLED: "0" }, okFetch())).toBeUndefined();
  });

  it("returns undefined when the flag is on but there's no AI binding", () => {
    expect(iconAnalyzerForEnv({ ICON_VISION_ENABLED: "1" }, okFetch())).toBeUndefined();
  });

  it("returns an analyzer when flag on + binding present", () => {
    expect(iconAnalyzerForEnv({ AI: ai, ICON_VISION_ENABLED: "true" }, okFetch())).toBeTypeOf(
      "function",
    );
  });
});

describe("the analyzer itself", () => {
  it("fetches the artwork and returns the measured composition", async () => {
    const ai = reply('{"layout":"other","hasText":true}');
    const fetchFn = okFetch();
    const analyze = iconAnalyzerForEnv({ AI: ai, ICON_VISION_ENABLED: "1" }, fetchFn)!;
    expect(await analyze("icon.png")).toEqual({ layout: "other", hasText: true });
    expect(fetchFn).toHaveBeenCalledWith("icon.png");
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it("degrades to null on a failed fetch, without calling the model", async () => {
    const ai = reply('{"layout":"other","hasText":true}');
    const fetchFn = vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }));
    const analyze = iconAnalyzerForEnv({ AI: ai, ICON_VISION_ENABLED: "1" }, fetchFn)!;
    expect(await analyze("gone.png")).toBeNull();
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("degrades to null on empty or oversized artwork", async () => {
    const ai = reply('{"layout":"other","hasText":true}');
    const empty = iconAnalyzerForEnv({ AI: ai, ICON_VISION_ENABLED: "1" }, okFetch([]))!;
    expect(await empty("empty.png")).toBeNull();

    const huge = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(2 * 1024 * 1024),
    }));
    const big = iconAnalyzerForEnv({ AI: ai, ICON_VISION_ENABLED: "1" }, huge)!;
    expect(await big("huge.png")).toBeNull();
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("degrades to null when the model throws or replies with garbage", async () => {
    const boom = { run: vi.fn(async () => { throw new Error("model down"); }) };
    const a1 = iconAnalyzerForEnv({ AI: boom, ICON_VISION_ENABLED: "1" }, okFetch())!;
    expect(await a1("icon.png")).toBeNull();

    const junk = reply("I think it's a nice icon!");
    const a2 = iconAnalyzerForEnv({ AI: junk, ICON_VISION_ENABLED: "1" }, okFetch())!;
    expect(await a2("icon.png")).toBeNull();
  });

  it("asks for observable composition, not a quality judgement", async () => {
    const ai = reply('{"layout":"other","hasText":false}');
    const analyze = iconAnalyzerForEnv({ AI: ai, ICON_VISION_ENABLED: "1" }, okFetch())!;
    await analyze("icon.png");
    const { prompt } = ai.run.mock.calls[0]![1] as { prompt: string };
    expect(prompt).toMatch(/do not judge/i);
    expect(prompt).toMatch(/observable/i);
  });
});

describe("analyzeIconSet", () => {
  it("measures each distinct url once, preserving input order", async () => {
    const analyzer = vi.fn(async () => CENTRED);
    const out = await analyzeIconSet(analyzer, ["a.png", "b.png"]);
    expect(out).toEqual([CENTRED, CENTRED]);
    expect(analyzer).toHaveBeenCalledTimes(2);
  });

  it("reads a repeated url once and reuses the result", async () => {
    const analyzer = vi.fn(async () => CENTRED);
    const out = await analyzeIconSet(analyzer, ["a.png", "b.png", "a.png"]);
    expect(out).toEqual([CENTRED, CENTRED, CENTRED]);
    expect(analyzer).toHaveBeenCalledTimes(2); // not 3
  });

  it("caches a null result too, so a broken url isn't retried", async () => {
    const analyzer = vi.fn(async () => null);
    const out = await analyzeIconSet(analyzer, ["bad.png", "bad.png"]);
    expect(out).toEqual([null, null]);
    expect(analyzer).toHaveBeenCalledTimes(1);
  });

  it("emits null for a missing url without spending an inference", async () => {
    const analyzer = vi.fn(async () => CENTRED);
    const out = await analyzeIconSet(analyzer, [null, undefined, "a.png"]);
    expect(out).toEqual([null, null, CENTRED]);
    expect(analyzer).toHaveBeenCalledTimes(1);
  });

  it("stops spending at the limit and returns the rest unmeasured", async () => {
    const analyzer = vi.fn(async () => CENTRED);
    const urls = ["1.png", "2.png", "3.png", "4.png"];
    const out = await analyzeIconSet(analyzer, urls, 2);
    expect(analyzer).toHaveBeenCalledTimes(2);
    // over budget → null (unmeasured), never a guessed composition
    expect(out).toEqual([CENTRED, CENTRED, null, null]);
  });

  it("keeps one output slot per input url even when over budget", async () => {
    const analyzer = vi.fn(async () => CENTRED);
    const urls = Array.from({ length: 20 }, (_, i) => `${i}.png`);
    const out = await analyzeIconSet(analyzer, urls);
    expect(out).toHaveLength(20);
    expect(analyzer).toHaveBeenCalledTimes(MAX_ICONS_PER_RUN);
  });

  it("does not let the budget be exhausted by repeats of one url", async () => {
    const analyzer = vi.fn(async () => CENTRED);
    const urls = [...Array.from({ length: 20 }, () => "same.png"), "new.png"];
    const out = await analyzeIconSet(analyzer, urls);
    expect(analyzer).toHaveBeenCalledTimes(2); // "same.png" once + "new.png"
    expect(out[out.length - 1]).toEqual(CENTRED); // the distinct one still got read
  });

  it("survives an analyzer that throws, keeping the rest of the batch", async () => {
    const analyzer = vi.fn(async (url: string) => {
      if (url === "boom.png") throw new Error("network");
      return CENTRED;
    });
    const out = await analyzeIconSet(analyzer, ["boom.png", "fine.png"]);
    expect(out).toEqual([null, CENTRED]);
  });
});
