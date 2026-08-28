/**
 * The agent activity drawer — docked, always visible, expandable.
 *
 * Deliberately NOT a Human/Agent toggle. The page cannot tell whether a person
 * or an agent is looking at it — `navigator.modelContext` says only that the
 * browser supports WebMCP, and the W3C's own agent-identity work (webmcp#105)
 * is still open precisely because tools "cannot determine who is calling them".
 * A toggle would ask the visitor to declare something the platform can't verify,
 * and nobody would click it. So the drawer is simply always on: it shows the
 * page's offer to any agent, and a person watching sees exactly what theirs did.
 *
 * WHY DOCKED: this used to render at the end of the page. On a real queue that
 * put it ~11,000px down — measured in production — so the only human-visible
 * evidence that any of this exists was invisible unless you knew to scroll for
 * it. A drawer is fixed to the viewport, collapsed by default, and expands in
 * place; the page behind it scrolls normally.
 *
 * Each tool carries a reads/writes badge, and one line spanning all of them
 * says the thing the whole entry rests on: none of them can approve.
 */
import { useEffect, useRef, useState } from "react";
import type { ToolSpec } from "./manifest.js";
import type { ActivityEntry } from "./useWebMcp.js";
import { durationMs, formatDuration, runningNames, summarize } from "./panelState.js";
import { useAgentChat } from "./useAgentChat.js";
import type { LiveTool } from "./agentLoop.js";

const PHASE_LABEL: Record<ActivityEntry["phase"], string> = {
  start: "running",
  done: "ok",
  error: "failed",
};

export function ToolsPanel({
  supported,
  tools,
  activity,
  getTools = null,
  executeTool = null,
  route = null,
  context = "app",
}: {
  supported: boolean;
  tools: readonly ToolSpec[];
  activity: readonly ActivityEntry[];
  getTools?: (() => Promise<readonly LiveTool[]>) | null;
  executeTool?: ((tool: LiveTool, args: string) => Promise<unknown>) | null;
  /** The manifest route pattern, so the tour uses this page's own tools. */
  route?: string | null;
  /**
   * "public" on the marketing pages, where the visitor may have no idea what
   * any of this is. The drawer stays there because the tools are real — a
   * signed-out agent can run `audit_app` and get a genuine credential-free
   * listing audit — but it behaves more quietly: it explains itself, and it
   * never opens itself, because an unexplained panel springing open on a
   * marketing page is an interruption rather than an invitation.
   */
  context?: "app" | "public";
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const summary = summarize(activity);
  const chat = useAgentChat({ getTools, executeTool, route: route ?? undefined });

  // Auto-expand the first time a tool actually runs: the moment worth seeing is
  // the one where an agent starts working, and a visitor who has never opened
  // the drawer would otherwise miss exactly that. Only once — after that the
  // drawer respects whatever the person last chose, because yanking it open on
  // every call would fight someone who deliberately collapsed it.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (context === "public") return;
    if (!autoOpened.current && summary.runningCount > 0) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [summary.runningCount, context]);

  if (!supported) {
    return (
      <aside className="webmcp-drawer" data-testid="webmcp-panel" data-open="false">
        <div className="webmcp-bar">
          <span className="webmcp-bar-title">Agent tools</span>
          <span className="webmcp-note" data-testid="webmcp-unsupported">
            This browser doesn’t support WebMCP, so no tools are offered here.
          </span>
        </div>
      </aside>
    );
  }

  const running = runningNames(activity);

  return (
    <aside
      className="webmcp-drawer"
      data-testid="webmcp-panel"
      data-open={open ? "true" : "false"}
      data-live={summary.runningCount > 0 ? "true" : "false"}
    >
      <button
        type="button"
        className="webmcp-bar"
        data-testid="webmcp-toggle"
        aria-expanded={open}
        aria-controls="webmcp-body"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="webmcp-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="webmcp-bar-title">
          Agent tools <span className="webmcp-count" data-testid="webmcp-count">{tools.length}</span>
        </span>
        {/*
          The collapsed bar has to earn its place: what is HAPPENING is the only
          thing worth a glance, so it carries live state and otherwise stays
          quiet rather than repeating the tool count in words.
        */}
        <span className="webmcp-bar-status" data-testid="webmcp-status">
          {summary.runningCount > 0 ? (
            <>
              <span className="webmcp-dot" aria-hidden="true" />
              {summary.latestName}
            </>
          ) : summary.failed > 0 ? (
            <span className="webmcp-bar-failed">{summary.failed} failed</span>
          ) : summary.completed > 0 ? (
            `${summary.completed} call${summary.completed === 1 ? "" : "s"}`
          ) : (
            "idle"
          )}
        </span>
      </button>

      <div className="webmcp-body" id="webmcp-body" hidden={!open}>
        <p className="webmcp-note">
          {context === "public"
            ? "This page offers these tools to an AI agent running in your browser. They are real: an agent can audit any App Store listing here without an account. None of them can approve or ship anything."
            : "Offered to your browser agent on this page, and swapped as you navigate."}
        </p>

        <ul className="webmcp-tools">
          {tools.map((t) => (
            <li
              key={t.name}
              className="webmcp-tool"
              data-testid={`tool-${t.name}`}
              data-mode={t.writes ? "writes" : "reads"}
              data-active={running.has(t.name) ? "true" : "false"}
            >
              <span className="webmcp-tool-name">{t.name}</span>
              <span className="webmcp-tool-effect">{t.effect}</span>
              {/* The badge says what the bar used to imply, in the app's own
                  status vocabulary — so no legend is needed to decode it. */}
              <span className="webmcp-mode">{t.writes ? "writes" : "reads"}</span>
            </li>
          ))}
        </ul>

        <p className="webmcp-boundary" data-testid="webmcp-boundary">
          <strong>No tool here can approve.</strong> An agent can read, explain, draft and stage —
          approving needs a real click, and the server rejects an approval that didn’t come from
          one. Approving isn’t shipping either: nothing reaches the App Store without a further
          human step.
        </p>

        <div className="webmcp-chat" data-testid="webmcp-chat">
          <h3 className="webmcp-subtitle">Ask your agent</h3>
          {/*
            The transcript renders in EVERY state. It used to live inside the
            agent-only branch, which meant the scripted tour ran invisibly —
            the tools fired and nobody saw a thing.
          */}
          {chat.turns.length > 0 ? (
            <ol className="webmcp-turns" data-testid="webmcp-turns">
              {chat.turns.map((t, i) => (
                <li key={i} className="webmcp-turn" data-kind={t.kind}>
                  {t.kind === "tool" ? (
                    <>
                      <span className="webmcp-turn-who">ran</span>
                      <span className="webmcp-turn-tool">{t.name}</span>
                      <span className="webmcp-turn-text">{t.text.split("\n")[0]}</span>
                    </>
                  ) : (
                    <>
                      <span className="webmcp-turn-who">
                        {t.kind === "user" ? "you" : chat.status === "touring" ? "script" : "agent"}
                      </span>
                      <span className="webmcp-turn-text">{t.text}</span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          ) : null}
          {chat.status === "offerable" || chat.status === "downloading" ? (
            /*
              The model is not here yet but the browser can fetch it. Offering
              that beats declaring no agent exists — which is what this used to
              do, and it was wrong: `create()` performs the download.
            */
            <div data-testid="webmcp-chat-offer">
              <p className="webmcp-note">
                An AI agent can run on this page, entirely on your device — no account and no
                data leaving the browser. Chrome needs to download the model first.
              </p>
              {chat.status === "downloading" ? (
                <p className="webmcp-note" data-testid="webmcp-download-progress">
                  Downloading… {Math.round(chat.progress * 100)}%
                </p>
              ) : (
                <button
                  type="button"
                  className="webmcp-ask-send"
                  data-testid="webmcp-download"
                  onClick={() => void chat.download()}
                >
                  Download the model
                </button>
              )}
            </div>
          ) : chat.status === "unavailable" || chat.status === "touring" ? (
            /*
              No on-device model here and none obtainable. The tour drives the
              REAL tools against real data; only the narration is scripted, and
              it says so rather than passing itself off as an agent.
            */
            <div data-testid="webmcp-chat-unsupported">
              <p className="webmcp-note">
                This browser has no on-device model, so there is no agent to ask here. The tools
                above are still offered to any agent that can reach them — and you can watch them
                run.
              </p>
              <button
                type="button"
                className="webmcp-ask-send"
                data-testid="webmcp-tour"
                disabled={chat.status === "touring"}
                onClick={() => void chat.runTour()}
              >
                {chat.status === "touring" ? "Running…" : "Run a scripted tour"}
              </button>
              {chat.turns.length > 0 ? (
                <p className="webmcp-scripted" data-testid="webmcp-scripted-label">
                  Scripted walkthrough — the tool calls and their results are real; the wording
                  between them is written, not generated.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <form
                className="webmcp-ask"
                onSubmit={(e) => {
                  e.preventDefault();
                  const q = draft.trim();
                  if (!q || chat.status !== "ready") return;
                  setDraft("");
                  void chat.send(q);
                }}
              >
                <input
                  className="webmcp-ask-input"
                  data-testid="webmcp-ask-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    chat.status === "warming"
                      ? "Loading the on-device model…"
                      : "What is waiting on me?"
                  }
                  disabled={chat.status !== "ready"}
                />
                <button
                  type="submit"
                  className="webmcp-ask-send"
                  data-testid="webmcp-ask-send"
                  disabled={chat.status !== "ready" || !draft.trim()}
                >
                  {chat.status === "thinking" ? "…" : "Ask"}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="webmcp-activity" data-testid="webmcp-activity">
          <h3 className="webmcp-subtitle">Recent calls</h3>
          {activity.length === 0 ? (
            <p className="webmcp-note">No tool calls yet.</p>
          ) : (
            <ol className="webmcp-log">
              {activity.map((e) => {
                const ms = durationMs(activity, e);
                return (
                  <li key={e.seq} className="webmcp-log-row" data-phase={e.phase}>
                    <span className="webmcp-log-name">{e.name}</span>
                    <span className="webmcp-log-phase">{PHASE_LABEL[e.phase]}</span>
                    {/* Absent when unmeasurable — never rendered as 0ms. */}
                    {ms === null ? null : (
                      <span className="webmcp-log-ms">{formatDuration(ms)}</span>
                    )}
                    {e.message ? <span className="webmcp-log-message">{e.message}</span> : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </aside>
  );
}
