import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuditResultCard } from "./AuditResultCard.js";

const preview = (over: Record<string, unknown> = {}) =>
  ({
    appName: "Weatherly",
    auditGrade: "B",
    leadKeyword: "weather",
    leadRank: 12,
    keywordsChecked: 20,
    inTop10: 4,
    sample: [{ keyword: "weather", rank: 12 }],
    breakdown: [],
    score: 71,
    fieldsMeasured: 3,
    fieldsTotal: 4,
    ...over,
  }) as never;

describe("<AuditResultCard />", () => {
  it("shows a quiet placeholder before an audit runs — never a fake sample", () => {
    render(<AuditResultCard result={null} onSignIn={vi.fn()} />);
    expect(screen.getByTestId("audit-result-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-grade")).toBeNull();
    expect(screen.queryByTestId("preview-sample")).toBeNull();
  });

  it("renders the measured grade, lead rank and coverage summary", () => {
    render(<AuditResultCard result={preview()} onSignIn={vi.fn()} />);
    expect(screen.getByTestId("preview-grade")).toHaveTextContent("B");
    const summary = screen.getByTestId("preview-summary");
    expect(summary).toHaveTextContent("#12");
    expect(summary).toHaveTextContent("4 of 20");
  });

  it("states what was checked when nothing ranks — no invented lead rank", () => {
    render(<AuditResultCard result={preview({ leadKeyword: null, leadRank: null })} onSignIn={vi.fn()} />);
    expect(screen.getByTestId("preview-summary")).toHaveTextContent("none ranking yet");
  });

  it("renders an unmeasured sample rank as '—', never a fabricated number", () => {
    render(<AuditResultCard result={preview({ sample: [{ keyword: "radar", rank: null }] })} onSignIn={vi.fn()} />);
    expect(screen.getByTestId("preview-sample")).toHaveTextContent("—");
  });

  it("omits the grade block entirely when the read produced no grade", () => {
    render(<AuditResultCard result={preview({ auditGrade: null })} onSignIn={vi.fn()} />);
    expect(screen.queryByTestId("preview-grade")).toBeNull();
  });

  it("the sign-in CTA calls back", () => {
    const onSignIn = vi.fn();
    render(<AuditResultCard result={preview()} onSignIn={onSignIn} />);
    screen.getByTestId("preview-signin").click();
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});
