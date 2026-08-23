/**
 * The rendered actor mark. Same rule as RunTriggerNote: a run with no trigger
 * gets silence, not a default.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunActorMark } from "./RunActorMark.js";

describe("<RunActorMark />", () => {
  it("marks an agent-opened run and names it for a screen reader", () => {
    render(<RunActorMark trigger={{ source: "cron", reasons: [] }} />);
    const el = screen.getByTestId("run-actor");
    expect(el).toHaveAttribute("data-actor", "agent");
    expect(el).toHaveAccessibleName("ShipASO opened this run on its own.");
  });

  it("marks a human-requested run differently", () => {
    render(<RunActorMark trigger={{ source: "manual", reasons: [] }} />);
    expect(screen.getByTestId("run-actor")).toHaveAttribute("data-actor", "human");
  });

  it("renders NOTHING when the run carried no trigger", () => {
    const { container } = render(<RunActorMark trigger={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("run-actor")).toBeNull();
  });

  it("renders nothing when the field is absent entirely (older Worker)", () => {
    const { container } = render(<RunActorMark trigger={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a glyph, so the signal survives greyscale and screenshots", () => {
    render(<RunActorMark trigger={{ source: "cron", reasons: [] }} />);
    expect(screen.getByTestId("run-actor").textContent).not.toBe("");
  });
});
