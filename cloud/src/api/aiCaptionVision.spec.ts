import { describe, expect, it, vi } from "vitest";
import { captionAnalyzerForEnv, parseCaptionReply } from "./aiCaptionVision.js";

const okFetch = (bytes = [1, 2, 3, 4]) =>
  vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(bytes).buffer }));

describe("parseCaptionReply", () => {
  it("parses a clean JSON object", () => {
    expect(parseCaptionReply('{"caption":"Track workouts","style":"feature"}')).toEqual({
      caption: "Track workouts",
      style: "feature",
    });
  });

  it("tolerates prose/markdown around the JSON", () => {
    const text = 'Here you go:\n```json\n{"caption":"Get fit","style":"outcome"}\n```';
    expect(parseCaptionReply(text)).toEqual({ caption: "Get fit", style: "outcome" });
  });

  it("trims the caption", () => {
    expect(parseCaptionReply('{"caption":"  Do more  ","style":"feature"}')?.caption).toBe("Do more");
  });

  it("returns null on non-JSON, empty caption, or a bad style", () => {
    expect(parseCaptionReply("no json here")).toBeNull();
    expect(parseCaptionReply("{not valid json}")).toBeNull();
    expect(parseCaptionReply('{"caption":"","style":"feature"}')).toBeNull();
    expect(parseCaptionReply('{"caption":"x","style":"vibes"}')).toBeNull();
    expect(parseCaptionReply('{"style":"feature"}')).toBeNull();
  });
});

describe("captionAnalyzerForEnv gating", () => {
  const ai = { run: vi.fn(async () => ({ response: '{"caption":"x","style":"feature"}' })) };

  it("returns undefined when the flag is off (even with a binding)", () => {
    expect(captionAnalyzerForEnv({ AI: ai }, okFetch())).toBeUndefined();
    expect(captionAnalyzerForEnv({ AI: ai, CAPTION_OCR_ENABLED: "0" }, okFetch())).toBeUndefined();
  });

  it("returns undefined when the flag is on but there's no AI binding", () => {
    expect(captionAnalyzerForEnv({ CAPTION_OCR_ENABLED: "1" }, okFetch())).toBeUndefined();
  });

  it("returns an analyzer when flag on + binding present", () => {
    expect(captionAnalyzerForEnv({ AI: ai, CAPTION_OCR_ENABLED: "true" }, okFetch())).toBeTypeOf(
      "function",
    );
  });
});

describe("captionAnalyzerForEnv analyzer", () => {
  it("fetches the image, runs the vision model, and returns the parsed analysis", async () => {
    const run = vi.fn(
      async (_model: string, _input: unknown) =>
        ({ response: '{"caption":"Track it","style":"feature"}' }) as unknown,
    );
    const fetchFn = okFetch([9, 8, 7]);
    const analyzer = captionAnalyzerForEnv({ AI: { run }, CAPTION_OCR_ENABLED: "1" }, fetchFn)!;
    const out = await analyzer("https://cdn/shot.png");

    expect(out).toEqual({ caption: "Track it", style: "feature" });
    expect(fetchFn).toHaveBeenCalledWith("https://cdn/shot.png");
    // the model is handed the image bytes as a number[]
    expect(run.mock.calls[0]![1]).toMatchObject({ image: [9, 8, 7] });
  });

  it("degrades to null on a non-ok fetch (never throws)", async () => {
    const ai = { run: vi.fn() };
    const fetchFn = vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }));
    const analyzer = captionAnalyzerForEnv({ AI: ai, CAPTION_OCR_ENABLED: "1" }, fetchFn)!;
    expect(await analyzer("https://cdn/shot.png")).toBeNull();
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("degrades to null on empty image bytes", async () => {
    const ai = { run: vi.fn() };
    const analyzer = captionAnalyzerForEnv({ AI: ai, CAPTION_OCR_ENABLED: "1" }, okFetch([]))!;
    expect(await analyzer("https://cdn/shot.png")).toBeNull();
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("degrades to null on an oversized image (never OOMs the run)", async () => {
    const ai = { run: vi.fn() };
    // 6 MB buffer — over the ~5 MB cap; must not be spread into a number[] / sent
    const bigFetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(6 * 1024 * 1024) }));
    const analyzer = captionAnalyzerForEnv({ AI: ai, CAPTION_OCR_ENABLED: "1" }, bigFetch)!;
    expect(await analyzer("https://cdn/huge.png")).toBeNull();
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("degrades to null when the model throws", async () => {
    const ai = {
      run: vi.fn(async () => {
        throw new Error("model unavailable");
      }),
    };
    const analyzer = captionAnalyzerForEnv({ AI: ai, CAPTION_OCR_ENABLED: "1" }, okFetch())!;
    expect(await analyzer("https://cdn/shot.png")).toBeNull();
  });

  it("degrades to null when the model reply is unparseable", async () => {
    const ai = { run: vi.fn(async () => ({ response: "I could not read the image." })) };
    const analyzer = captionAnalyzerForEnv({ AI: ai, CAPTION_OCR_ENABLED: "1" }, okFetch())!;
    expect(await analyzer("https://cdn/shot.png")).toBeNull();
  });
});
