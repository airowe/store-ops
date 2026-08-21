/**
 * The trigger note renders the agent's reason for opening a run — or renders
 * nothing. There is no third option: an older run with no trigger must not get
 * a narrated one.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunTriggerNote } from "./RunTriggerNote.js";

describe("RunTriggerNote", () => {
  it("shows the agent's reasons on a cron run", () => {
    render(
      <RunTriggerNote
        trigger={{ source: "cron", reasons: ["lead keyword fell 4 places", "competitor changed subtitle"] }}
      />,
    );
    expect(screen.getByTestId("run-trigger")).toBeTruthy();
    expect(screen.getByText(/lead keyword fell 4 places/)).toBeTruthy();
    expect(screen.getByText(/competitor changed subtitle/)).toBeTruthy();
  });

  it("marks a cron run as agent-initiated so the UI can style it as a decision", () => {
    render(<RunTriggerNote trigger={{ source: "cron", reasons: ["x"] }} />);
    expect(screen.getByTestId("run-trigger").getAttribute("data-actor")).toBe("agent");
  });

  it("renders nothing at all when the run carried no trigger", () => {
    const { container } = render(<RunTriggerNote trigger={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the headline but no reason list when there are no reasons", () => {
    render(<RunTriggerNote trigger={{ source: "manual", reasons: [] }} />);
    expect(screen.getByTestId("run-trigger")).toBeTruthy();
    expect(screen.queryByTestId("run-trigger-reasons")).toBeNull();
  });

  it("does not credit the agent for a run the human asked for", () => {
    render(<RunTriggerNote trigger={{ source: "manual", reasons: [] }} />);
    expect(screen.getByTestId("run-trigger").getAttribute("data-actor")).toBe("human");
  });
});
