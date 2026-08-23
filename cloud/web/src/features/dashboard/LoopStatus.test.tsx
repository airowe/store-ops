/**
 * The autopilot, made visible.
 *
 * The copy rules are the load-bearing part and each exists for a reason:
 *   - "checks", not "runs" — a biweekly slot can pass without a sweep firing
 *     (min-gap), so "next run" would sometimes be a lie.
 *   - never "manages"/"ships" — the agent watches, finds, and prepares;
 *     approving and submitting stay the user's. This is the invariant that
 *     makes the "autopilot" framing defensible rather than an overclaim.
 *   - no invented next slot — measured-or-nothing applies to a future time
 *     exactly as it applies to a rank.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoopStatus } from "./LoopStatus.js";

const NOW = new Date("2026-08-20T12:00:00Z");

describe("<LoopStatus />", () => {
  it("states the last check, the next check, and the work done", () => {
    render(
      <LoopStatus
        summary={{
          lastSweepAt: "2026-08-17T09:00:00Z",
          nextSweepAt: "2026-08-24T09:00:00Z",
          agentRunCount: 9,
          agentSince: "2026-06-21T09:00:00Z",
        }}
        now={NOW}
      />,
    );
    const el = screen.getByTestId("loop-status");
    expect(el).toHaveTextContent(/3 days ago/);
    expect(el).toHaveTextContent(/9 checks/);
  });

  it("says 'check', never 'run' — a slot can pass without a sweep", () => {
    render(
      <LoopStatus
        summary={{ lastSweepAt: "2026-08-17T09:00:00Z", nextSweepAt: "2026-08-24T09:00:00Z", agentRunCount: 9, agentSince: null }}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("loop-status")).not.toHaveTextContent(/next run/i);
  });

  it("never claims the agent manages or ships — the whole product rests on this", () => {
    render(
      <LoopStatus
        summary={{ lastSweepAt: "2026-08-17T09:00:00Z", nextSweepAt: "2026-08-24T09:00:00Z", agentRunCount: 9, agentSince: "2026-06-21T09:00:00Z" }}
        now={NOW}
      />,
    );
    const text = screen.getByTestId("loop-status").textContent ?? "";
    expect(text).not.toMatch(/manag(e|es|ing)/i);
    expect(text).not.toMatch(/\bships?\b|shipped for you/i);
  });

  it("a never-swept fleet says when the FIRST check lands, not 'last checked never'", () => {
    render(
      <LoopStatus
        summary={{ lastSweepAt: null, nextSweepAt: "2026-08-24T09:00:00Z", agentRunCount: 0, agentSince: null }}
        now={NOW}
      />,
    );
    const el = screen.getByTestId("loop-status");
    expect(el).toHaveTextContent(/first check/i);
    expect(el).not.toHaveTextContent(/never/i);
  });

  it("no computable next slot → no next-check clause, and none invented", () => {
    render(
      <LoopStatus
        summary={{ lastSweepAt: "2026-08-17T09:00:00Z", nextSweepAt: null, agentRunCount: 9, agentSince: null }}
        now={NOW}
      />,
    );
    const el = screen.getByTestId("loop-status");
    expect(el).toHaveTextContent(/3 days ago/);
    expect(el).not.toHaveTextContent(/next check/i);
  });

  it("zero agent runs states no count at all — '0 checks' reads as broken", () => {
    render(
      <LoopStatus
        summary={{ lastSweepAt: null, nextSweepAt: "2026-08-24T09:00:00Z", agentRunCount: 0, agentSince: null }}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("loop-status")).not.toHaveTextContent(/0 checks/);
  });

  it("renders nothing when there is no loop data at all", () => {
    const { container } = render(
      <LoopStatus
        summary={{ lastSweepAt: null, nextSweepAt: null, agentRunCount: 0, agentSince: null }}
        now={NOW}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("singularises one check", () => {
    render(
      <LoopStatus
        summary={{ lastSweepAt: "2026-08-19T09:00:00Z", nextSweepAt: null, agentRunCount: 1, agentSince: "2026-08-19T09:00:00Z" }}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("loop-status")).toHaveTextContent(/1 check\b/);
  });
});
