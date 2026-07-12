/**
 * Post-rejection assistant (#178 Phase 4). Paste an App Review rejection message
 * → we identify the guideline Apple cited, quote it verbatim (when we hold its
 * text), recommend fix-vs-appeal as a labelled heuristic, and scaffold both
 * Resolution Center replies for the developer to complete.
 *
 * Honesty, load-bearing: the guideline is PARSED from Apple's own message; the
 * quote is verbatim or absent (never invented); the recommendation is flagged a
 * heuristic; the drafts carry [bracketed placeholders] the developer fills in —
 * we never assert facts about their app.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient, RejectionAnalysis } from "@shipaso/api";
import { analyzeRejection } from "@shipaso/api";

const PATH_LABEL: Record<string, string> = {
  fix_and_resubmit: "Fix & resubmit",
  appeal: "Appeal",
  unclear: "Your call",
};

export function RejectionAssistantCard({ client }: { client: ApiClient }) {
  const [text, setText] = useState("");
  const run = useMutation<RejectionAnalysis, Error, string>({
    mutationFn: (t: string) => analyzeRejection(client, t),
  });
  const a = run.data;

  return (
    <div className="card" data-testid="rejection-assistant-card">
      <b>Got rejected? Paste the message</b>
      <p className="micro">
        We identify the guideline Apple cited, quote the rule, and draft your reply — the recommendation is a heuristic, your call.
      </p>
      <textarea
        data-testid="ra-text"
        rows={4}
        placeholder="Paste the App Review rejection here…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: "100%", marginTop: 6 }}
      />
      <button className="btn" data-testid="ra-run" disabled={run.isPending || !text.trim()} onClick={() => run.mutate(text)}>
        {run.isPending ? "Analyzing…" : "Analyze"}
      </button>

      {a ? (
        <div data-testid="ra-result" style={{ marginTop: 10 }}>
          {a.primaryGuideline ? (
            <p className="micro" data-testid="ra-guideline">
              Cited: <b>Guideline {a.primaryGuideline}</b>
              {a.guidelines.length > 1 ? ` (+ ${a.guidelines.slice(1).join(", ")})` : ""}
            </p>
          ) : null}
          {a.quote ? <p className="micro faint" data-testid="ra-quote">“{a.quote}”</p> : null}

          <p className="micro" data-testid="ra-recommendation">
            Suggested path: <b>{PATH_LABEL[a.recommended] ?? a.recommended}</b> — {a.rationale}
          </p>

          <details data-testid="ra-fix" style={{ marginTop: 6 }}>
            <summary className="micro">Draft — fix &amp; resubmit</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{a.drafts.fix_and_resubmit}</pre>
          </details>
          <details data-testid="ra-appeal">
            <summary className="micro">Draft — appeal</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{a.drafts.appeal}</pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}
