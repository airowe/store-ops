/**
 * The action row under a finding's fix — #324, "deep-link or act, don't hand out
 * homework".
 *
 * Deliberately its OWN component rather than more JSX inside `FindingRow`: the
 * fix/action rendering and the card's disclosure behaviour are separate concerns
 * that are being changed by separate work in flight, and keeping them apart
 * means neither has to fight the other in a merge.
 *
 * Honesty, load-bearing:
 *   • the ASC link is always on Apple's console host, but it is not always
 *     precise — `appScoped: false` means we could only reach the generic
 *     console, and we SAY so rather than implying we've landed the customer on
 *     their own app's page. (Apple doesn't document the console's routes, so a
 *     verified per-app path is something we can only sometimes offer.)
 *   • the in-product handoff renders only when the server named a tool. No tool
 *     means no handoff — never a guessed one.
 *   • nothing here writes anything: the ASC link navigates, the tool button
 *     moves the customer to a builder they still drive themselves.
 *
 * Accessibility: the link is a real `<a>` and the handoff is a real `<button>` —
 * native semantics, no hand-rolled key handling (this repo's rule).
 */
import type { Finding, FindingTool } from "@shipaso/api";

export function FindingActionRow({
  finding,
  onTool,
}: {
  finding: Finding;
  onTool?: ((tool: FindingTool) => void) | undefined;
}) {
  const action = finding.action;
  if (!action) return null;

  const tool = action.tool;
  return (
    <p className="micro finding-action" style={{ margin: "4px 0 0" }}>
      <a
        href={action.url}
        target="_blank"
        rel="noreferrer noopener"
        data-testid={`finding-action-${finding.id}`}
      >
        {action.label}
      </a>
      {/* Only offered when the server named a real builder for this finding. */}
      {tool && onTool ? (
        <button
          type="button"
          className="finding-tool"
          data-testid={`finding-tool-${finding.id}`}
          onClick={() => onTool(tool)}
        >
          {tool === "screenshots" ? "Plan the screenshot set →" : "Generate CPP sets →"}
        </button>
      ) : null}
      {/* An unscoped link is honest about being unscoped — we never let a
          generic console URL read as "we took you to your app's settings". */}
      {!action.appScoped ? (
        <span className="muted" data-testid={`finding-action-note-${finding.id}`}>
          {" "}
          (we couldn’t link to your app’s exact section)
        </span>
      ) : null}
    </p>
  );
}
