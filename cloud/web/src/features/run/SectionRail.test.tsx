import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { SectionRail, type RailItem } from "./SectionRail.js";

const ITEMS: RailItem[] = [
  { id: "changes", label: "Changes", group: "changes" },
  { id: "audit", label: "Audit", group: "needs" },
  { id: "metadata", label: "Metadata", group: "fyi" },
  { id: "screenshots", label: "Screenshots", group: "healthy" },
];

describe("<SectionRail />", () => {
  it("renders only the group headers that have items", () => {
    render(<SectionRail items={ITEMS} activeId="changes" onSelect={vi.fn()} />);
    const rail = screen.getByTestId("section-rail");
    expect(rail).toHaveTextContent("Needs you");
    expect(rail).toHaveTextContent("Changes");
    expect(rail).toHaveTextContent("FYI");
    expect(rail).toHaveTextContent("Healthy");
  });

  it("omits a group header when no item belongs to it", () => {
    const noNeeds = ITEMS.filter((i) => i.group !== "needs");
    render(<SectionRail items={noNeeds} activeId="changes" onSelect={vi.fn()} />);
    expect(screen.getByTestId("section-rail")).not.toHaveTextContent("Needs you");
  });

  it("renders each item as a focusable button", () => {
    render(<SectionRail items={ITEMS} activeId="changes" onSelect={vi.fn()} />);
    const buttons = within(screen.getByTestId("section-rail")).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Audit", "Changes", "Metadata", "Screenshots"]);
  });

  it("marks the active item", () => {
    render(<SectionRail items={ITEMS} activeId="audit" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Audit" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "Changes" })).not.toHaveClass("active");
  });

  it("calls onSelect with the item id on click", () => {
    const onSelect = vi.fn();
    render(<SectionRail items={ITEMS} activeId="changes" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Metadata" }));
    expect(onSelect).toHaveBeenCalledWith("metadata");
  });

  it("renders nothing when given no items", () => {
    render(<SectionRail items={[]} activeId="" onSelect={vi.fn()} />);
    expect(screen.queryByTestId("section-rail")).toBeNull();
  });

  it("renders group headers in fixed order and clusters items correctly, regardless of input order", () => {
    const outOfOrder: RailItem[] = [
      { id: "screenshots", label: "Screenshots", group: "healthy" },
      { id: "metadata", label: "Metadata", group: "fyi" },
      { id: "changes", label: "Changes", group: "changes" },
      { id: "audit", label: "Audit", group: "needs" },
    ];
    const { container } = render(
      <SectionRail items={outOfOrder} activeId="changes" onSelect={vi.fn()} />,
    );
    const headers = Array.from(container.querySelectorAll(".rail-group-label")).map(
      (el) => el.textContent,
    );
    expect(headers).toEqual(["Needs you", "Changes", "FYI", "Healthy"]);

    const buttons = within(screen.getByTestId("section-rail")).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Audit", "Changes", "Metadata", "Screenshots"]);
  });
});
