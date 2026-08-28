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
function fakeModel(
  replies: string[],
  opts: { availability?: string; progress?: number[]; failCreate?: boolean } = {},
) {
  const prompts: string[] = [];
  let i = 0;
  let creates = 0;
  const destroy = vi.fn();
  (globalThis as never as { LanguageModel: unknown }).LanguageModel = {
    availability: async () => opts.availability ?? "available",
    create: async (o?: { monitor?: (m: unknown) => void }) => {
      creates += 1;
      if (opts.failCreate) throw new Error("download refused");
      // Replay download progress the way the spec describes it.
      if (o?.monitor && opts.progress) {
        const listeners: Array<(e: { loaded: number }) => void> = [];
        o.monitor({
          addEventListener: (_t: string, cb: (e: { loaded: number }) => void) => listeners.push(cb),
        } as never);
        for (const loaded of opts.progress) for (const cb of listeners) cb({ loaded });
      }
      return {
        prompt: async (input: string) => {
          prompts.push(input);
          return replies[i++] ?? "";
        },
        destroy,
      };
    },
  };
  return { prompts, destroy, created: () => creates };
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
  it("is unavailable when the browser has no Prompt API at all", async () => {
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });

  it("is OFFERABLE when the model can be downloaded — not a refusal", async () => {
    // The distinction that matters: `create()` performs the download, so
    // telling this browser there is no agent would be false.
    fakeModel([], { availability: "downloadable" });
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("offerable"));
  });

  it("is offerable mid-download too", async () => {
    fakeModel([], { availability: "downloading" });
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("offerable"));
  });

  it("does NOT start a ~2GB download on its own", async () => {
    const { created } = fakeModel([], { availability: "downloadable" });
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("offerable"));
    expect(created()).toBe(0);
  });

  it("is unavailable when WebMCP itself is absent, model or no model", async () => {
    fakeModel([]);
    const { result } = renderHook(() =>
      useAgentChat({ getTools: null, executeTool: null }),
    );
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
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

describe("useAgentChat — downloading the model", () => {
  it("becomes ready once the download completes", async () => {
    fakeModel(["whoami"], { availability: "downloadable", progress: [0.5, 1] });
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("offerable"));
    await act(async () => {
      await result.current.download();
    });
    expect(result.current.status).toBe("ready");
  });

  it("reports progress while it runs", async () => {
    fakeModel([], { availability: "downloadable", progress: [0.25, 0.75] });
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("offerable"));
    await act(async () => {
      await result.current.download();
    });
    // The last reported value survives; 0.75 was seen, not invented.
    expect(result.current.progress).toBeCloseTo(0.75);
  });

  it("falls back to unavailable when the download fails", async () => {
    fakeModel([], { availability: "downloadable", failCreate: true });
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("offerable"));
    await act(async () => {
      await result.current.download();
    });
    expect(result.current.status).toBe("unavailable");
  });
});

/**
 * The tour drives REAL tools. What it must never do is claim to be an agent —
 * the narration is written, and the surrounding UI says so.
 */
describe("useAgentChat — the scripted tour", () => {
  it("runs the real tools, in order, against real data", async () => {
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    await act(async () => {
      await result.current.runTour();
    });
    expect(h.executed).toEqual(["whoami", "list_pending_runs"]);
    const toolTurns = result.current.turns.filter((t) => t.kind === "tool");
    expect(toolTurns).toHaveLength(2);
    expect(toolTurns[0]).toMatchObject({ ok: true, text: "12 runs waiting" });
  });

  it("SKIPS steps whose tool this route does not offer", async () => {
    // describe_boundary is not in the harness's tool list, so its step drops
    // rather than running against nothing.
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    await act(async () => {
      await result.current.runTour();
    });
    expect(h.executed).not.toContain("describe_boundary");
  });

  it("ALWAYS ends on the boundary, which runs no tool", async () => {
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    await act(async () => {
      await result.current.runTour();
    });
    const last = result.current.turns.at(-1)!;
    expect(last.kind).toBe("agent");
    expect(last.text).toMatch(/approves, ships or publishes/i);
  });

  it("does not leave the chat claiming to have an agent afterwards", async () => {
    const h = harness();
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    await act(async () => {
      await result.current.runTour();
    });
    expect(result.current.status).toBe("unavailable");
  });

  it("reports a failing tool honestly mid-tour rather than stopping", async () => {
    const h = harness({
      execute: async () => {
        throw new Error("authentication required");
      },
    });
    const { result } = renderHook(() => useAgentChat(h));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    await act(async () => {
      await result.current.runTour();
    });
    const toolTurns = result.current.turns.filter((t) => t.kind === "tool");
    expect(toolTurns.every((t) => t.kind === "tool" && !t.ok)).toBe(true);
    // and it still reaches the boundary statement
    expect(result.current.turns.at(-1)!.text).toMatch(/approves, ships or publishes/i);
  });
});
