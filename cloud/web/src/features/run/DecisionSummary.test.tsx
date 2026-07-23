import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Finding } from "@shipaso/api";
import { DecisionSummary } from "./DecisionSummary.js";

const f = (severity: Finding["severity"], id: string): Finding => ({
  id, surface: "s", severity, impact: "ranking", title: id, detail: "", fix: "",
});

describe("<DecisionSummary />", () => {
  it("summarizes keyword delta and blocker count at a glance", () => {
    render(
      <DecisionSummary
        current={{ keywords: "a,b,c" }}
        proposed={{ keywords: "a,c,d" }}
        findings={[f("critical", "c1"), f("warn", "w1"), f("good", "g1"), f("info", "i1")]}
      />,
    );
    expect(screen.getByTestId("decision-summary")).toBeInTheDocument();
    // +1 (d) / -1 (b)
    expect(screen.getByTestId("ds-keywords")).toHaveTextContent("+1");
    expect(screen.getByTestId("ds-keywords")).toHaveTextContent("−1");
    // 2 blockers (critical + warn)
    expect(screen.getByTestId("ds-blockers")).toHaveTextContent("2 need you");
    // remaining checks
    expect(screen.getByTestId("ds-rest")).toHaveTextContent("2 more checks");
  });

  it("names the single blocker when exactly one", () => {
    render(
      <DecisionSummary current={{ keywords: "a" }} proposed={{ keywords: "a" }}
        findings={[f("critical", "only-blocker")]} />,
    );
    expect(screen.getByTestId("ds-blockers")).toHaveTextContent("only-blocker");
  });
});
