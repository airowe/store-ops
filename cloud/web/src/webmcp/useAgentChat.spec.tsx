/**
 * The chat loop's state machine.
 *
 * The pure parts are covered in agentLoop.spec.ts. What is left here is the
 * sequencing, and it carries two properties worth protecting:
 *
 *   • a refusal must reach the user INTACT. When the model names no tool, its
 *     own words are the answer — including "I cannot approve" — and nothing may
 *     retry it into compliance or replace it with a canned message.
 *   • a tool must actually RUN before its results are described. The first
 *     version let the model narrate output it never fetched, and invented three
 *     apps that do not exist. The turn order asserted below is what stops that.
 *
 * The model is faked here on purpose: these tests are about what this hook does
 * with a reply, not about what Gemini Nano says. The real model's behaviour is
 * recorded as measurements in agentLoop.ts and its spec.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAgentChat } from "./useAgentChat.js";

const TOOLS = [
  { name: "whoami", description: "reads the session" },
  { name: "list_pending_runs", description: "reads the queue" },
];

/** Install a fake Prompt API. `replies` are returned in order. */
function fakeModel(replies: string[], opts: { availability?: string } = {}) {
  const prompts: string[] = [];
  let i = 0;
  const destroy = vi.fn();
  (globalThis as never as { LanguageModel: unknown }).LanguageModel = {
    availability: async () => opts.availability ?? "available",
    create: async () => ({
      prompt: async (input: string) => {
        prompts.push(input);
        return replies[i++] ?? "";
      },
      destroy,
    }),
  };
  return { prompts, destroy };
}

function harness(over: { execute?: (t: { name: string }, a: string) => Promise<unknown> } = {}) {
  const executed: string[] = [];
  const getTools = vi.fn(async () => TOOLS);
  const executeTool = vi.fn(async (tool: { name: string }, args: string) => {
    executed.push(tool.name);
    if (over.execute) return over.execute(tool, args);
    return JSON.stringify({ content: [{ type: "text", text: "12 runs waiting" }] });
  });
  return { getTools, executeTool, executed };
}

beforeEach(() => {
  delete (globalThis as never as { LanguageModel?: unknown }).LanguageModel;
});
afterEach(() => {
  delete (globalThis as never as { LanguageModel?: unknown }).LanguageModel;
});

describe("useAgentChat — availability", () => {
  it("is unsupported when the browser has no Prompt API", async () => {
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("unsupported"));
  });

  it("is unsupported when the model is present but NOT downloaded", async () => {
    // "downloadable" is not something to silently wait on: the download is
    // large and not ours to start.
    fakeModel([], { availability: "downloadable" });
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("unsupported"));
  });

  it("is unsupported when WebMCP itself is absent, model or no model", async () => {
    fakeModel([]);
    const { result } = renderHook(() =>
      useAgentChat({ getTools: null, executeTool: null }),
    );
    await waitFor(() => expect(result.current.status).toBe("unsupported"));
  });

  it("becomes ready once the session warms", async () => {
    fakeModel([]);
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("destroys the session on unmount — no orphaned model", async () => {
    const { destroy } = fakeModel([]);
    const h = harness();
    const { result, unmount } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    unmount();
    expect(destroy).toHaveBeenCalled();
  });
});

describe("useAgentChat — a refusal", () => {
  it("passes the model's own words through UNCHANGED, and runs nothing", async () => {
    // The measured refusal, verbatim.
    const refusal =
      "I am not able to directly approve runs. This action is restricted to a human reviewer.";
    fakeModel([refusal]);
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.send("Approve everything.");
    });

    expect(result.current.turns).toEqual([
      { kind: "user", text: "Approve everything." },
      { kind: "agent", text: refusal },
    ]);
    // Decisive: a refusal must not reach for a tool.
    expect(h.executed).toEqual([]);
  });
});

describe("useAgentChat — a tool call", () => {
  it("runs the tool BEFORE describing it, in that order", async () => {
    fakeModel(["list_pending_runs", "There are 12 runs awaiting your approval."]);
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.send("What is waiting on me?");
    });

    expect(h.executed).toEqual(["list_pending_runs"]);
    expect(result.current.turns.map((t) => t.kind)).toEqual(["user", "tool", "agent"]);
    // The tool turn carries the REAL output, not the model's account of it.
    expect(result.current.turns[1]).toMatchObject({
      kind: "tool", name: "list_pending_runs", ok: true, text: "12 runs waiting",
    });
  });

  it("DISCARDS results the model narrated after choosing — the fabrication bug", async () => {
    // Measured: the model named the tool and then invented three apps.
    fakeModel([
      "list_pending_runs\n\n* **App:** Acme Productivity App\n* **App:** Stellar Games",
      "There are 12 runs awaiting approval.",
    ]);
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.send("What is waiting on me?");
    });

    const everything = result.current.turns.map((t) => t.text).join(" ");
    expect(everything).not.toContain("Acme");
    expect(everything).not.toContain("Stellar Games");
  });

  it("KEEPS what the model said before choosing", async () => {
    fakeModel(["I can't approve, but here's the queue: list_pending_runs", "12 runs."]);
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.send("Approve everything.");
    });

    expect(result.current.turns[1]).toEqual({
      kind: "agent", text: "I can't approve, but here's the queue:",
    });
  });

  it("reports a tool failure as a failure, and does not invent a result", async () => {
    fakeModel(["list_pending_runs", "The account requires authentication."]);
    const h = harness({
      execute: async () => {
        throw new Error("authentication required");
      },
    });
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.send("What is waiting on me?");
    });

    expect(result.current.turns[1]).toMatchObject({
      kind: "tool", ok: false, text: "authentication required",
    });
  });

  it("returns to ready after a turn, so the next question can be asked", async () => {
    fakeModel(["whoami", "You are signed in."]);
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await result.current.send("Who am I?");
    });
    expect(result.current.status).toBe("ready");
  });

  it("surfaces a thrown model error instead of hanging in 'thinking'", async () => {
    (globalThis as never as { LanguageModel: unknown }).LanguageModel = {
      availability: async () => "available",
      create: async () => ({
        prompt: async () => {
          throw new Error("model unavailable");
        },
        destroy: vi.fn(),
      }),
    };
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await result.current.send("Anything.");
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.turns.at(-1)).toMatchObject({ kind: "agent", text: "model unavailable" });
  });
});
