/**
 * The always-visible WebMCP panel.
 *
 * Deliberately NOT a Human/Agent toggle. The page cannot tell whether a person
 * or an agent is looking at it — `navigator.modelContext` says only that the
 * browser supports WebMCP, and the W3C's own agent-identity work (webmcp#105)
 * is still open precisely because tools "cannot determine who is calling them".
 * A toggle would ask the visitor to declare something the platform can't verify,
 * and nobody would click it. So the panel is simply always on: it shows the
 * page's offer to any agent, and a person watching sees exactly what theirs did.
 *
 * The capability legend has three states, and the third is the point of the
 * whole entry: reads, writes, and — spanning every tool — cannot approve.
 */
import type { ToolSpec } from "./manifest.js";
import type { ActivityEntry } from "./useWebMcp.js";

/**
 * Which tools are mid-call. A name is "running" when its most recent event is a
 * `start`; a `done`/`error` after it clears the highlight. Derived from the log
 * rather than tracked separately, so the panel can never disagree with it.
 */
function runningNames(activity: readonly ActivityEntry[]): Set<string> {
  const latest = new Map<string, ActivityEntry["phase"]>();
  // The log is newest-first, so the FIRST entry seen for a name is its latest.
  for (const e of activity) if (!latest.has(e.name)) latest.set(e.name, e.phase);
  return new Set([...latest].filter(([, phase]) => phase === "start").map(([name]) => name));
}

const PHASE_LABEL: Record<ActivityEntry["phase"], string> = {
  start: "running",
  done: "ok",
  error: "failed",
};

export function ToolsPanel({
  supported,
  tools,
  activity,
}: {
  supported: boolean;
  tools: readonly ToolSpec[];
  activity: readonly ActivityEntry[];
}) {
  if (!supported) {
    return (
      <aside className="webmcp-panel" data-testid="webmcp-panel">
        <h2 className="webmcp-title">Agent tools</h2>
        <p className="webmcp-note" data-testid="webmcp-unsupported">
          This browser doesn’t support WebMCP, so no tools are offered here. In a browser that
          does, your own agent can read this queue, explain any proposal and draft alternatives —
          and still can’t approve one.
        </p>
      </aside>
    );
  }

  const running = runningNames(activity);

  return (
    <aside className="webmcp-panel" data-testid="webmcp-panel">
      <h2 className="webmcp-title">
        Agent tools <span className="webmcp-count" data-testid="webmcp-count">{tools.length}</span>
      </h2>
      <p className="webmcp-note">
        Offered to your browser agent on this page, and swapped as you navigate.
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
          </li>
        ))}
      </ul>

      {/* The legend's third row is the claim the whole entry rests on. */}
      <div className="webmcp-legend">
        <span className="webmcp-key webmcp-key-reads">reads</span>
        <span className="webmcp-key webmcp-key-writes">writes</span>
      </div>
      <p className="webmcp-boundary" data-testid="webmcp-boundary">
        <strong>No tool here can approve.</strong> An agent can read, explain, draft and stage —
        approving needs a real click, and the server rejects an approval that didn’t come from
        one. Approving isn’t shipping either: nothing reaches the App Store without a further
        human step.
      </p>

      <div className="webmcp-activity" data-testid="webmcp-activity">
        <h3 className="webmcp-subtitle">Recent calls</h3>
        {activity.length === 0 ? (
          <p className="webmcp-note">No tool calls yet.</p>
        ) : (
          <ol className="webmcp-log">
            {activity.map((e) => (
              <li key={e.seq} className="webmcp-log-row" data-phase={e.phase}>
                <span className="webmcp-log-name">{e.name}</span>
                <span className="webmcp-log-phase">{PHASE_LABEL[e.phase]}</span>
                {e.message ? <span className="webmcp-log-message">{e.message}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
