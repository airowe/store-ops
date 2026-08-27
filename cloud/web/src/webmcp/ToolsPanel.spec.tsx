/**
 * The panel is the human-facing half of the human-agent experience: it shows
 * what the page has offered an agent, what each tool does, and — the part no
 * other WebMCP demo has — the one thing NO tool can do.
 *
 * It is always visible. There is no Human/Agent toggle: the page cannot tell
 * who is viewing it, and a control that claims otherwise would be theatre.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ToolsPanel } from "./ToolsPanel.js";
import { toolsForRoute } from "./manifest.js";

const tools = toolsForRoute("/runs/r_1");

describe("ToolsPanel", () => {
  it("lists every tool offered on this route", () => {
    render(<ToolsPanel supported tools={tools} activity={[]} />);
    for (const t of tools) expect(screen.getByText(t.name)).toBeInTheDocument();
  });

  it("shows the tool count", () => {
    render(<ToolsPanel supported tools={tools} activity={[]} />);
    expect(screen.getByTestId("webmcp-count")).toHaveTextContent(String(tools.length));
  });

  it("states plainly that no tool here can approve", () => {
    render(<ToolsPanel supported tools={tools} activity={[]} />);
    expect(screen.getByTestId("webmcp-boundary")).toHaveTextContent(/approv/i);
  });

  it("distinguishes reading tools from writing ones", () => {
    render(<ToolsPanel supported tools={tools} activity={[]} />);
    const readOnly = tools.filter((t) => t.readOnly)[0]!;
    const writes = tools.filter((t) => t.writes)[0]!;
    expect(screen.getByTestId(`tool-${readOnly.name}`)).toHaveAttribute("data-mode", "reads");
    expect(screen.getByTestId(`tool-${writes.name}`)).toHaveAttribute("data-mode", "writes");
  });

  it("says WebMCP is unavailable — rather than showing an empty list — when unsupported", () => {
    render(<ToolsPanel supported={false} tools={[]} activity={[]} />);
    expect(screen.getByTestId("webmcp-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("webmcp-count")).not.toBeInTheDocument();
  });

  it("highlights a tool that is running right now", () => {
    render(
      <ToolsPanel
        supported
        tools={tools}
        activity={[{ name: "get_run", phase: "start", at: 1, seq: 1 }]}
      />,
    );
    expect(screen.getByTestId("tool-get_run")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("tool-explain_run")).toHaveAttribute("data-active", "false");
  });

  it("stops highlighting once the call has settled", () => {
    render(
      <ToolsPanel
        supported
        tools={tools}
        activity={[
          { name: "get_run", phase: "done", at: 2, seq: 2 },
          { name: "get_run", phase: "start", at: 1, seq: 1 },
        ]}
      />,
    );
    expect(screen.getByTestId("tool-get_run")).toHaveAttribute("data-active", "false");
  });

  it("shows the recent calls so a person can watch their agent work", () => {
    render(
      <ToolsPanel
        supported
        tools={tools}
        activity={[{ name: "explain_run", phase: "done", at: 1, seq: 1 }]}
      />,
    );
    expect(within(screen.getByTestId("webmcp-activity")).getByText(/explain_run/)).toBeInTheDocument();
  });

  it("reports a failed call as failed rather than silently", () => {
    render(
      <ToolsPanel
        supported
        tools={tools}
        activity={[{ name: "get_run", phase: "error", message: "403", at: 1, seq: 1 }]}
      />,
    );
    const log = within(screen.getByTestId("webmcp-activity"));
    expect(log.getByText(/403/)).toBeInTheDocument();
  });

  it("says nothing has been called yet rather than showing a bare empty box", () => {
    render(<ToolsPanel supported tools={tools} activity={[]} />);
    expect(screen.getByTestId("webmcp-activity")).toHaveTextContent(/no tool calls yet/i);
  });
});
