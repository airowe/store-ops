/**
 * The Reasoner backend selector — Claude first, Workers AI second, undefined
 * last (deterministic classifiers downstream). The Claude path is exercised
 * through an injected messages-create fn so no spec ever touches the network.
 *
 * Contract with downstream (keywordReasoner / reviewSentiment / planScreenshots):
 * a Reasoner returns RAW model text; empty/garbage/errors are already handled
 * there by deterministic fallbacks. So a Claude refusal maps to "" (fall back,
 * never surface a half-answer) and API errors are allowed to throw (callers
 * catch and fall back).
 */
import { describe, expect, it } from "vitest";
import { claudeReasoner, reasonerBackend, reasonerForEnv } from "./aiReasoner.js";

type CreateParams = Record<string, unknown>;

function fakeCreate(result: { stop_reason: string; content: unknown[] }) {
  const calls: CreateParams[] = [];
  const create = async (params: CreateParams) => {
    calls.push(params);
    return result;
  };
  return { calls, create };
}

describe("claudeReasoner", () => {
  it("sends the prompt with the JSON-only system contract at low effort", async () => {
    const { calls, create } = fakeCreate({
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"ok":true}' }],
    });
    const reasoner = claudeReasoner(create, "claude-opus-5");
    const out = await reasoner("classify these keywords");
    expect(out).toBe('{"ok":true}');

    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.model).toBe("claude-opus-5");
    expect(req.output_config).toEqual({ effort: "low" });
    expect(String(req.system)).toContain("ONLY the requested JSON");
    expect(req.messages).toEqual([{ role: "user", content: "classify these keywords" }]);
  });

  it("joins multiple text blocks and ignores non-text blocks", async () => {
    const { create } = fakeCreate({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: '{"a":' },
        { type: "text", text: "1}" },
      ],
    });
    expect(await claudeReasoner(create, "m")("p")).toBe('{"a":1}');
  });

  it("a refusal returns empty text — downstream falls back deterministically", async () => {
    const { create } = fakeCreate({
      stop_reason: "refusal",
      content: [],
    });
    expect(await claudeReasoner(create, "m")("p")).toBe("");
  });
});

describe("reasonerForEnv — backend priority", () => {
  const ai = { run: async () => ({ response: "llama says" }) };

  it("no key, no binding → none (deterministic path downstream)", () => {
    expect(reasonerBackend(undefined)).toBe("none");
    expect(reasonerBackend({})).toBe("none");
    expect(reasonerForEnv(undefined)).toBeUndefined();
    expect(reasonerForEnv({})).toBeUndefined();
  });

  it("ANTHROPIC_API_KEY set → Claude, even with no AI binding", () => {
    expect(reasonerBackend({ ANTHROPIC_API_KEY: "sk-ant-test" })).toBe("claude");
    expect(reasonerForEnv({ ANTHROPIC_API_KEY: "sk-ant-test" })).toBeTypeOf("function");
  });

  it("AI binding alone still yields the Workers AI reasoner", async () => {
    expect(reasonerBackend({ AI: ai })).toBe("workers-ai");
    const reasoner = reasonerForEnv({ AI: ai });
    expect(await reasoner!("hi")).toBe("llama says");
  });

  it("with BOTH configured, Claude wins — the key is a deliberate choice, the binding is ambient", () => {
    expect(reasonerBackend({ ANTHROPIC_API_KEY: "sk-ant-test", AI: ai })).toBe("claude");
  });

  it("a blank key does not select Claude", () => {
    expect(reasonerBackend({ ANTHROPIC_API_KEY: "  ", AI: ai })).toBe("workers-ai");
  });
});
