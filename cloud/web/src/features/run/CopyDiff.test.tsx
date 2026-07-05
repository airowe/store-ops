import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
