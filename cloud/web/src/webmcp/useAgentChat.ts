/**
 * Conversation state for the in-page agent.
 *
 * The loop per turn: the model picks a tool from the live manifest, the tool
 * runs through `navigator.modelContext`, and the model reports the result. If
 * it names no tool, its answer stands on its own — which is what a refusal
 * looks like, and it is left intact rather than retried into compliance.
 *
 * The session is warmed on mount because the first `create()` costs ~20s of
 * model load (measured, Chrome 151) and a demo that stalls on its first
 * question reads as broken.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getLanguageModel,
  pickTool,
  readinessOf,
  readToolText,
  routingOnly,
  systemPrompt,
  tourFor,
  type LanguageModelSession,
  type LiveTool,
  type Turn,
} from "./agentLoop.js";

/**
 * `unsupported` used to mean three different things. Splitting them is the
 * whole point: a browser that has simply not downloaded the model yet can be
 * OFFERED one, and a browser that never will can still be shown the real tools
 * running under a scripted tour.
 */
export type ChatStatus =
  | "warming"
  | "ready"
  | "thinking"
  /** No model yet, but `create()` would fetch one. */
  | "offerable"
  /** Downloading now; `progress` is 0..1. */
  | "downloading"
  /** No on-device model here at all. The tour is what is left. */
  | "unavailable"
  /** The scripted tour is playing. */
  | "touring";

export function useAgentChat(opts: {
  /** Reads the tools currently registered. Null when WebMCP is absent. */
  getTools: (() => Promise<readonly LiveTool[]>) | null;
  /** Runs one tool and returns its raw result. */
  executeTool: ((tool: LiveTool, args: string) => Promise<unknown>) | null;
}) {
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [status, setStatus] = useState<ChatStatus>("warming");
  const [progress, setProgress] = useState(0);
  const session = useRef<LanguageModelSession | null>(null);
  const { getTools, executeTool } = opts;

  // Warm the model once, on mount. Guarded against StrictMode's double-invoke
  // and against the component unmounting mid-load, which would otherwise leave
  // a session nobody destroys.
  useEffect(() => {
    let cancelled = false;
    const api = getLanguageModel();
    if (!api || !getTools || !executeTool) {
      setStatus("unavailable");
      return;
    }
    void (async () => {
      try {
        const readiness = readinessOf(await api.availability());
        // A download is large and starting one unasked would be rude, so
        // "offerable" waits for the person to choose. Only an already-present
        // model is warmed automatically.
        if (readiness !== "ready") {
          if (!cancelled) setStatus(readiness === "offerable" ? "offerable" : "unavailable");
          return;
        }
        const tools = await getTools();
        const s = await api.create({
          initialPrompts: [{ role: "system", content: systemPrompt(tools) }],
        });
        if (cancelled) {
          s.destroy();
          return;
        }
        session.current = s;
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
      session.current?.destroy();
      session.current = null;
    };
  }, [getTools, executeTool]);

  const send = useCallback(
    async (text: string) => {
      const s = session.current;
      if (!s || !getTools || !executeTool) return;
      setTurns((t) => [...t, { kind: "user", text }]);
      setStatus("thinking");
      try {
        const tools = await getTools();
        const names = tools.map((t) => t.name);
        const reply = await s.prompt(text);
        const chosen = pickTool(reply, names);
        const tool = tools.find((t) => t.name === chosen);

        if (!tool) {
          // No tool named. The model's own words are the answer — including
          // when those words are "I cannot approve", which is the case this
          // whole surface exists to produce.
          setTurns((t) => [...t, { kind: "agent", text: reply.trim() }]);
          return;
        }

        let out: string;
        let ok = true;
        try {
          out = readToolText(await executeTool(tool, "{}"));
        } catch (e) {
          ok = false;
          out = e instanceof Error ? e.message : String(e);
        }
        // Anything the model said AFTER naming the tool is discarded: measured,
        // it continues past the name and invents results it never fetched.
        const aside = routingOnly(reply, tool.name);
        setTurns((t) => [
          ...t,
          ...(aside ? [{ kind: "agent" as const, text: aside }] : []),
          { kind: "tool" as const, name: tool.name, ok, text: out },
        ]);

        // The summary prompt is emphatic because the model will otherwise pad
        // real output with invented extras — measured: it named three apps that
        // do not exist. Only what the tool returned may be described.
        const summary = await s.prompt(
          "Below is the REAL output of the tool you just ran. Summarise ONLY what " +
            "it contains, in one or two sentences. Do not add apps, names, numbers " +
            "or details that do not appear in it.\n\n" +
            out.slice(0, 1200),
        );
        setTurns((t) => [...t, { kind: "agent", text: summary.trim() }]);
      } catch (e) {
        setTurns((t) => [
          ...t,
          { kind: "agent", text: e instanceof Error ? e.message : String(e) },
        ]);
      } finally {
        setStatus("ready");
      }
    },
    [getTools, executeTool],
  );

  /**
   * Start the model download. Per the Prompt API spec, `create()` performs it
   * and resolves when the model is usable, reporting progress through
   * `monitor`. Only called from a click — never on load, because ~2GB is not
   * something to spend on someone's behalf.
   */
  const download = useCallback(async () => {
    const api = getLanguageModel();
    if (!api || !getTools) return;
    setStatus("downloading");
    setProgress(0);
    try {
      const tools = await getTools();
      const s = await api.create({
        initialPrompts: [{ role: "system", content: systemPrompt(tools) }],
        monitor: (m: {
          addEventListener: (t: string, cb: (e: { loaded: number }) => void) => void;
        }) => {
          m.addEventListener("downloadprogress", (e) => setProgress(e.loaded));
        },
      });
      session.current = s;
      setStatus("ready");
    } catch {
      // A failed or refused download leaves the tour as the honest fallback.
      setStatus("unavailable");
    }
  }, [getTools]);

  /**
   * Play the scripted tour: real tools, real data, scripted narration.
   *
   * The narration is labelled as scripted by the UI. It drives the same
   * `executeTool` path the agent uses, so what a visitor watches is the actual
   * surface — only the choosing is canned, and the tour never claims otherwise.
   */
  const runTour = useCallback(async () => {
    if (!getTools || !executeTool) return;
    setStatus("touring");
    setTurns([]);
    try {
      const tools = await getTools();
      const steps = tourFor(tools.map((t) => t.name));
      for (const step of steps) {
        setTurns((t) => [...t, { kind: "agent", text: step.say }]);
        if (!step.tool) continue;
        const tool = tools.find((x) => x.name === step.tool);
        if (!tool) continue;
        let out: string;
        let ok = true;
        try {
          out = readToolText(await executeTool(tool, "{}"));
        } catch (e) {
          ok = false;
          out = e instanceof Error ? e.message : String(e);
        }
        setTurns((t) => [...t, { kind: "tool", name: tool.name, ok, text: out }]);
      }
    } finally {
      // Back to whatever it was: a tour does not grant an agent.
      setStatus(session.current ? "ready" : "unavailable");
    }
  }, [getTools, executeTool]);

  return { turns, status, progress, send, download, runTour };
}
