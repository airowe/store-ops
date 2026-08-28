/**
 * The panel is the human-facing half of the human-agent experience: it shows
 * what the page has offered an agent, what each tool does, and — the part no
 * other WebMCP demo has — the one thing NO tool can do.
 *
 * It is always visible. There is no Human/Agent toggle: the page cannot tell
 * who is viewing it, and a control that claims otherwise would be theatre.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

/**
 * DRAWER BEHAVIOUR.
 *
 * The tests above render the panel and query its contents, which passes whether
 * the drawer opens or not — testing-library finds `hidden` content by default.
 * These assert the thing a visitor actually experiences: it starts collapsed,
 * it opens on click, and it opens ITSELF the first time an agent starts working,
 * because that is the moment worth seeing and a collapsed drawer would hide it.
 */
describe("ToolsPanel — the drawer", () => {
  const entry = (name: string, phase: "start" | "done" | "error", seq: number) => ({
    name, phase, at: 1000 + seq, seq,
  });

  it("starts COLLAPSED — the page is not obstructed by default", () => {
    render(<ToolsPanel supported tools={tools} activity={[]} />);
    expect(screen.getByTestId("webmcp-panel")).toHaveAttribute("data-open", "false");
    expect(screen.getByTestId("webmcp-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on click and closes again", () => {
    render(<ToolsPanel supported tools={tools} activity={[]} />);
    const toggle = screen.getByTestId("webmcp-toggle");
    fireEvent.click(toggle);
    expect(screen.getByTestId("webmcp-panel")).toHaveAttribute("data-open", "true");
    fireEvent.click(toggle);
    expect(screen.getByTestId("webmcp-panel")).toHaveAttribute("data-open", "false");
  });

  it("AUTO-OPENS the first time a tool runs — the moment worth watching", () => {
    const { rerender } = render(<ToolsPanel supported tools={tools} activity={[]} />);
    expect(screen.getByTestId("webmcp-panel")).toHaveAttribute("data-open", "false");
    rerender(<ToolsPanel supported tools={tools} activity={[entry("whoami", "start", 1)]} />);
    expect(screen.getByTestId("webmcp-panel")).toHaveAttribute("data-open", "true");
  });

  it("does NOT re-open a drawer the person deliberately closed", () => {
    // Auto-open is a one-time courtesy. Yanking it back open on every call
    // would fight someone who closed it on purpose.
    const { rerender } = render(
      <ToolsPanel supported tools={tools} activity={[entry("whoami", "start", 1)]} />,
    );
    expect(screen.getByTestId("webmcp-panel")).toHaveAttribute("data-open", "true");
    fireEvent.click(screen.getByTestId("webmcp-toggle"));
    expect(screen.getByTestId("webmcp-panel")).toHaveAttribute("data-open", "false");
    rerender(<ToolsPanel supported tools={tools} activity={[entry("explain_run", "start", 2)]} />);
    expect(screen.getByTestId("webmcp-panel")).toHaveAttribute("data-open", "false");
  });

  it("shows the running tool in the collapsed bar, so live work is visible closed", () => {
    render(<ToolsPanel supported tools={tools} activity={[entry("explain_run", "start", 1)]} />);
    expect(screen.getByTestId("webmcp-status")).toHaveTextContent("explain_run");
  });

  it("reports failures in the bar rather than counting them as calls", () => {
    render(
      <ToolsPanel
        supported
        tools={tools}
        activity={[entry("whoami", "error", 2), entry("whoami", "start", 1)]}
      />,
    );
    expect(screen.getByTestId("webmcp-status")).toHaveTextContent("1 failed");
  });

  it("reads idle with no activity at all", () => {
    render(<ToolsPanel supported tools={tools} activity={[]} />);
    expect(screen.getByTestId("webmcp-status")).toHaveTextContent("idle");
  });

  it("marks each tool as reads or writes, and never mislabels a writer", () => {
    render(<ToolsPanel supported tools={tools} activity={[]} />);
    for (const t of tools) {
      const row = screen.getByTestId(`tool-${t.name}`);
      expect(row).toHaveAttribute("data-mode", t.writes ? "writes" : "reads");
      expect(within(row).getByText(t.writes ? "writes" : "reads")).toBeInTheDocument();
    }
  });
});

/**
 * The chat degrades honestly. Without an on-device model there is no agent to
 * ask, and the drawer says so rather than rendering a dead input.
 */
describe("ToolsPanel — the agent chat", () => {
  it("says there is no agent when the browser has no model", () => {
    render(<ToolsPanel supported tools={tools} activity={[]} />);
    fireEvent.click(screen.getByTestId("webmcp-toggle"));
    // jsdom has no LanguageModel, which is the majority case in the wild too.
    expect(screen.getByTestId("webmcp-chat-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("webmcp-ask-input")).not.toBeInTheDocument();
  });

  it("still offers the tools — the surface does not depend on the chat", () => {
    render(<ToolsPanel supported tools={tools} activity={[]} />);
    fireEvent.click(screen.getByTestId("webmcp-toggle"));
    expect(screen.getByTestId("webmcp-boundary")).toBeInTheDocument();
    for (const t of tools) expect(screen.getByText(t.name)).toBeInTheDocument();
  });
});
