import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SectionRail } from "./SectionRail.js";

beforeAll(() => {
  // jsdom lacks IntersectionObserver — provide a no-op so the component mounts.
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    class { observe() {} disconnect() {} unobserve() {} };
});

describe("<SectionRail />", () => {
  it("renders a jump link per section, in order", () => {
    render(<SectionRail items={[{ id: "changes", label: "Changes" }, { id: "audit", label: "Audit" }]} />);
    const rail = screen.getByTestId("section-rail");
    const links = within(rail).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#changes", "#audit"]);
    expect(rail).toHaveTextContent("Changes");
    expect(rail).toHaveTextContent("Audit");
  });

  it("renders nothing when given no sections", () => {
    render(<SectionRail items={[]} />);
    expect(screen.queryByTestId("section-rail")).toBeNull();
  });
});
