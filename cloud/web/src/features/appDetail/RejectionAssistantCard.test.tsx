import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient, RejectionAnalysis } from "@shipaso/api";
import { RejectionAssistantCard } from "./RejectionAssistantCard.js";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const client = {} as ApiClient;

const analysis: RejectionAnalysis = {
  guidelines: ["2.3.7"],
  primaryGuideline: "2.3.7",
  quote: "Metadata such as app names… should not include prices…",
  recommended: "fix_and_resubmit",
  rationale: "Guideline 2.3.7 is a metadata rule — usually the fastest fix. Heuristic, not a verdict.",
  drafts: {
    fix_and_resubmit: "Hello App Review team,\nThank you for the feedback regarding Guideline 2.3.7. [describe]…",
    appeal: "Hello App Review team,\nWe're writing regarding the rejection under Guideline 2.3.7. [reasoning]…",
  },
};

describe("<RejectionAssistantCard />", () => {
  it("analyzes pasted text and shows the guideline, quote, recommendation, and both drafts", async () => {
    const post = vi.spyOn(await import("@shipaso/api"), "analyzeRejection").mockResolvedValue(analysis);
    wrap(<RejectionAssistantCard client={client} />);
    fireEvent.change(screen.getByTestId("ra-text"), { target: { value: "Guideline 2.3.7 problem" } });
    fireEvent.click(screen.getByTestId("ra-run"));

    await waitFor(() => expect(screen.getByTestId("ra-result")).toBeInTheDocument());
    expect(post).toHaveBeenCalledWith(client, "Guideline 2.3.7 problem");
    expect(screen.getByTestId("ra-guideline")).toHaveTextContent("Guideline 2.3.7");
    expect(screen.getByTestId("ra-quote")).toHaveTextContent("should not include prices");
    expect(screen.getByTestId("ra-recommendation")).toHaveTextContent("Fix & resubmit");
    expect(screen.getByTestId("ra-fix")).toHaveTextContent("[describe]");
    expect(screen.getByTestId("ra-appeal")).toHaveTextContent("[reasoning]");
    post.mockRestore();
  });

  it("disables Analyze until text is entered", () => {
    wrap(<RejectionAssistantCard client={client} />);
    expect(screen.getByTestId("ra-run")).toBeDisabled();
    fireEvent.change(screen.getByTestId("ra-text"), { target: { value: "rejected" } });
    expect(screen.getByTestId("ra-run")).not.toBeDisabled();
  });
});
