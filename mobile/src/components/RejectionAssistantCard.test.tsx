/**
 * RejectionAssistantCard (#178 Phase 4) — the honesty invariants:
 *   • the cited guideline is PARSED from Apple's message, shown as such;
 *   • the quote is verbatim from the corpus, or an honest "no quote available"
 *     when the guideline isn't held — never invented;
 *   • the recommendation is a labelled heuristic ("your call"), not a verdict;
 *   • the drafts are SCAFFOLDS with [bracketed placeholders] left intact.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ApiClient } from "../api/client.js";
import type { RejectionAnalysis } from "../types/api.js";
import { RejectionAssistantCard } from "./RejectionAssistantCard.js";

function fakeClient(result: RejectionAnalysis): { client: ApiClient; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const client = {
    get: async () => ({}),
    post: async (_p: string, body?: unknown) => {
      bodies.push(body);
      return result;
    },
    request: async () => ({}),
  } as unknown as ApiClient;
  return { client, bodies };
}

const WITH_QUOTE: RejectionAnalysis = {
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

describe("RejectionAssistantCard", () => {
  it("keeps Analyze disabled until text is entered", () => {
    const { client } = fakeClient(WITH_QUOTE);
    render(<RejectionAssistantCard client={client} />);
    expect(screen.getByTestId("ra-run")).toBeDisabled();
    fireEvent.changeText(screen.getByTestId("ra-text"), "rejected");
    expect(screen.getByTestId("ra-run")).not.toBeDisabled();
  });

  it("analyzes pasted text → cited guideline, verbatim quote, heuristic recommendation, both drafts with placeholders intact", async () => {
    const { client, bodies } = fakeClient(WITH_QUOTE);
    render(<RejectionAssistantCard client={client} />);
    fireEvent.changeText(screen.getByTestId("ra-text"), "Guideline 2.3.7 problem");
    fireEvent.press(screen.getByTestId("ra-run"));

    await waitFor(() => expect(screen.getByTestId("ra-result")).toBeTruthy());
    expect(bodies[0]).toEqual({ text: "Guideline 2.3.7 problem" });
    expect(screen.getByTestId("ra-guideline")).toHaveTextContent(/2\.3\.7/);
    expect(screen.getByTestId("ra-quote")).toHaveTextContent(/should not include prices/);
    // recommendation is labelled a heuristic ("your call"), not a verdict
    expect(screen.getByTestId("ra-recommendation")).toHaveTextContent(/Fix & resubmit/);
    expect(screen.getByTestId("ra-recommendation")).toHaveTextContent(/heuristic|your call/i);
    // drafts keep their bracketed placeholders — the user completes them
    expect(screen.getByTestId("ra-fix")).toHaveTextContent(/\[describe\]/);
    expect(screen.getByTestId("ra-appeal")).toHaveTextContent(/\[reasoning\]/);
  });

  it("shows the parsed guideline with an honest 'no quote available' when it isn't in the corpus", async () => {
    const noCorpus: RejectionAnalysis = {
      guidelines: ["5.9.9"],
      primaryGuideline: "5.9.9",
      quote: null,
      recommended: "unclear",
      rationale: "We don't hold this rule's text — read Apple's message and decide. Your call.",
      drafts: {
        fix_and_resubmit: "Hello App Review team, [describe the change]…",
        appeal: "Hello App Review team, [explain why it complies]…",
      },
    };
    const { client } = fakeClient(noCorpus);
    render(<RejectionAssistantCard client={client} />);
    fireEvent.changeText(screen.getByTestId("ra-text"), "Guideline 5.9.9");
    fireEvent.press(screen.getByTestId("ra-run"));

    await waitFor(() => expect(screen.getByTestId("ra-guideline")).toHaveTextContent(/5\.9\.9/));
    // never a fabricated quote — an honest absence instead
    expect(screen.queryByTestId("ra-quote")).toBeNull();
    expect(screen.getByTestId("ra-no-quote")).toBeTruthy();
  });
});
