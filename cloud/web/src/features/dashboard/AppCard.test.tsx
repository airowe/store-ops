import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppCard } from "./AppCard.js";
import type { AppListItem } from "@shipaso/api";

const base: AppListItem = {
  id: "a1",
  name: "Acme",
  bundle_id: "com.acme.app",
  latest_run: { status: "awaiting_approval", created_at: "2026-07-01T00:00:00Z" },
  rank_summary: { lead_keyword: "todo", lead_rank: 3 },
  findings_summary: { label: "2 fixes", critical: 1 },
};

describe("<AppCard />", () => {
  it("renders a measured rank as #n", () => {
    render(<AppCard app={base} onOpen={() => {}} />);
    expect(screen.getByTestId("rank")).toHaveTextContent("todo: #3");
  });

  it("renders an UNMEASURED rank as an em-dash, never 0", () => {
    render(<AppCard app={{ ...base, rank_summary: { lead_keyword: "todo", lead_rank: null } }} onOpen={() => {}} />);
    const rank = screen.getByTestId("rank");
    expect(rank).toHaveTextContent("todo: —");
    expect(rank).not.toHaveTextContent("0");
  });

  it("shows 'no ranks checked yet' when there's no rank summary", () => {
    render(<AppCard app={{ ...base, rank_summary: null }} onOpen={() => {}} />);
    expect(screen.getByText(/no ranks checked yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("rank")).toBeNull();
  });

  it("only shows the findings label when the server returned one", () => {
    const { rerender } = render(<AppCard app={base} onOpen={() => {}} />);
    expect(screen.getByTestId("findings")).toHaveTextContent("2 fixes");
    rerender(<AppCard app={{ ...base, findings_summary: null }} onOpen={() => {}} />);
    expect(screen.queryByTestId("findings")).toBeNull();
  });

  it("renders the honest status label (awaiting approval)", () => {
    render(<AppCard app={base} onOpen={() => {}} />);
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
  });

  it("opens the app on click", () => {
    const onOpen = vi.fn();
    render(<AppCard app={base} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("app-card-a1"));
    expect(onOpen).toHaveBeenCalledWith("a1");
  });
});
