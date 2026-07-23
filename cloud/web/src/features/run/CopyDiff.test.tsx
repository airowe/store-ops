import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CopyDiff } from "./CopyDiff.js";

describe("<CopyDiff />", () => {
  it("shows a changed field with its char budget", () => {
    render(<CopyDiff current={{ name: "Old" }} proposed={{ name: "Brand New Name" }} />);
    expect(screen.getByTestId("diff-name")).toHaveClass("is-changed");
    expect(screen.getByTestId("count-name")).toHaveTextContent(`${"Brand New Name".length}/30`);
    expect(screen.getByTestId("now-name")).toHaveTextContent("Brand New Name");
  });

  it("flags an over-limit proposal loudly (never lets it look valid)", () => {
    const long = "x".repeat(35); // > 30
    render(<CopyDiff current={{ name: "Old" }} proposed={{ name: long }} />);
    expect(screen.getByTestId("count-name")).toHaveClass("over");
    expect(screen.getByTestId("now-name")).toHaveClass("invalid");
    expect(screen.getByTestId("over-name")).toHaveTextContent("Over the 30-char limit by 5");
  });

  it("an unread current field says '(was unread)' — not a fake empty", () => {
    render(<CopyDiff current={{}} proposed={{ subtitle: "New sub" }} />);
    expect(screen.getByText("(was unread)")).toBeInTheDocument();
  });

  it("omits a field with nothing proposed", () => {
    render(<CopyDiff current={{ name: "Old" }} proposed={{}} />);
    expect(screen.queryByTestId("diff-name")).toBeNull();
  });

  it("collapses to an honest empty state when nothing actually changed", () => {
    // name identical on both sides; subtitle/keywords 'proposed' but empty (unread → nothing)
    render(<CopyDiff current={{ name: "Same" }} proposed={{ name: "Same", subtitle: "", keywords: "" }} />);
    expect(screen.getByTestId("diff-none")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-name")).toBeNull();
    expect(screen.queryByTestId("diff-subtitle")).toBeNull();
    expect(screen.queryByTestId("diff-keywords")).toBeNull();
  });

  it("renders the keywords field as a token diff: removed struck, added highlighted, kept quiet", () => {
    render(
      <CopyDiff
        current={{ keywords: "mindfulness,calm,stress" }}
        proposed={{ keywords: "mindfulness,stress,sleep" }}
      />,
    );
    const row = screen.getByTestId("diff-keywords");
    // token chips present
    expect(within(row).getByTestId("kw-removed-calm")).toBeInTheDocument();
    expect(within(row).getByTestId("kw-added-sleep")).toBeInTheDocument();
    expect(within(row).getByTestId("kw-kept-mindfulness")).toBeInTheDocument();
    // summary line
    expect(row).toHaveTextContent("1 added");
    expect(row).toHaveTextContent("1 removed");
    // char budget still shown
    expect(within(row).getByTestId("count-keywords")).toBeInTheDocument();
  });
});
