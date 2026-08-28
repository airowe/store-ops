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
  readToolText,
  routingOnly,
  systemPrompt,
  type LanguageModelSession,
  type LiveTool,
  type Turn,
} from "./agentLoop.js";

export type ChatStatus = "unsupported" | "warming" | "ready" | "thinking";

export function useAgentChat(opts: {
  /** Reads the tools currently registered. Null when WebMCP is absent. */
  getTools: (() => Promise<readonly LiveTool[]>) | null;
  /** Runs one tool and returns its raw result. */
  executeTool: ((tool: LiveTool, args: string) => Promise<unknown>) | null;
}) {
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [status, setStatus] = useState<ChatStatus>("warming");
  const session = useRef<LanguageModelSession | null>(null);
  const { getTools, executeTool } = opts;

  // Warm the model once, on mount. Guarded against StrictMode's double-invoke
  // and against the component unmounting mid-load, which would otherwise leave
  // a session nobody destroys.
  useEffect(() => {
    let cancelled = false;
    const api = getLanguageModel();
    if (!api || !getTools || !executeTool) {
      setStatus("unsupported");
      return;
    }
    void (async () => {
      try {
        const availability = await api.availability();
        // "available" means downloaded and ready. Anything else — "downloadable",
        // "downloading", "unavailable" — is not something to silently wait on,
        // because the download is large and not ours to start.
        if (availability !== "available") {
          if (!cancelled) setStatus("unsupported");
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
        if (!cancelled) setStatus("unsupported");
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

  return { turns, status, send };
}
