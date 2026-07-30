/**
 * Where "Connect a key" actually goes.
 *
 * Reported from the live app: clicking through a run to "unlock your full
 * audit" landed on /settings — a global page that opens on Communications,
 * with no app context, no key form, and no way back to the run. A dead end,
 * for a user who already had a key stored.
 *
 * The connect UI is `<ConnectAscCard />`, and it lives on /apps/$id. It is
 * app-scoped by construction: it looks up the stored key for THAT app and,
 * when one exists, offers "Run keyed audit" instead of a paste box. Routing
 * to /settings could never have shown it.
 *
 * The run knows its app — `RunDetail.app_id`, which RunView already reads to
 * find the stored key. The bug was that the route discarded it.
 *
 * Asserted on the navigation target rather than on rendered output: the route
 * component's whole job is wiring, and the destination is the thing that was
 * wrong.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: "run-1" }),
}));

// RunView is exercised by its own suite; here it is a probe that surfaces the
// two callbacks so we can assert where each one points.
vi.mock("../features/run/RunView.js", () => ({
  RunView: ({
    onConnect,
    onAccountSettings,
  }: {
    onConnect?: (appId: string) => void;
    onAccountSettings?: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onConnect?.("app-42")}>
        connect
      </button>
      <button type="button" onClick={() => onAccountSettings?.()}>
        account
      </button>
    </div>
  ),
}));

vi.mock("../api.js", () => ({ client: {} }));

const { RunRoute } = await import("./run.js");

describe("the run route's connect destination", () => {
  beforeEach(() => navigate.mockClear());

  it("sends connect to the app page, where the key card lives", () => {
    render(<RunRoute />);
    fireEvent.click(screen.getByText("connect"));

    expect(navigate).toHaveBeenCalledWith({
      to: "/apps/$id",
      params: { id: "app-42" },
      search: { tab: "connections" },
    });
  });

  /**
   * The app page opens on monitoring by default and the key cards live on the
   * Connections tab. Landing on the right PAGE but the wrong tab is the same
   * dead end wearing a different hat, so the tab is part of the destination.
   */
  it("deep-links to the Connections tab, not just the app page", () => {
    render(<RunRoute />);
    fireEvent.click(screen.getByText("connect"));

    expect(navigate.mock.calls[0]?.[0]?.search).toEqual({ tab: "connections" });
  });

  it("never sends connect to the global settings page", () => {
    // The regression, named. /settings has no app context and no key form.
    render(<RunRoute />);
    fireEvent.click(screen.getByText("connect"));

    const targets = navigate.mock.calls.map((c) => c[0]?.to);
    expect(targets).not.toContain("/settings");
  });

  /**
   * The run page has a SECOND settings link — the MCP/agent handoff — and that
   * one is genuinely account-level. Keeping both on one callback is what let
   * the app-scoped CTA inherit the wrong destination, so they stay separate.
   */
  it("still routes the account-level MCP link to /settings", () => {
    render(<RunRoute />);
    fireEvent.click(screen.getByText("account"));

    expect(navigate).toHaveBeenCalledWith({ to: "/settings" });
  });
});
