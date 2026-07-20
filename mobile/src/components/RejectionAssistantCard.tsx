/**
 * RejectionAssistantCard (#178 Phase 4) — paste an App Review rejection message
 * and get: the guideline Apple cited, its verbatim rule text (when we hold it),
 * a fix-vs-appeal heuristic, and two scaffolded Resolution Center replies to
 * complete.
 *
 * Honesty, load-bearing: the guideline is PARSED from Apple's own message; the
 * quote is verbatim or an honest absence (never invented); the recommendation
 * is flagged a heuristic ("your call"); the drafts carry [bracketed
 * placeholders] the developer fills in — we never assert facts about their app.
 */
import { useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { analyzeRejection } from "../api/endpoints.js";
import type { RejectionAnalysis } from "../types/api.js";
import { palette, radius, spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";
import { TextField } from "./TextField.js";

const PATH_LABEL: Record<string, string> = {
  fix_and_resubmit: "Fix & resubmit",
  appeal: "Appeal",
  unclear: "Your call",
};

/** A bordered, monospace block for a draft reply (placeholders kept verbatim). */
function DraftBlock({ testID, title, body }: { testID: string; title: string; body: string }) {
  return (
    <View testID={testID} style={{ marginTop: spacing.sm }}>
      <AppText kind="micro">{title}</AppText>
      <View
        style={{
          borderColor: palette.line,
          borderWidth: 1,
          borderRadius: radius.base,
          padding: spacing.sm,
          marginTop: spacing.xs,
        }}
      >
        <AppText kind="mono" selectable>
          {body}
        </AppText>
      </View>
    </View>
  );
}

export function RejectionAssistantCard({ client }: { client: ApiClient }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<RejectionAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await analyzeRejection(client, trimmed));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t analyze that message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <AppText kind="lead">Got rejected? Paste the message</AppText>
      <AppText kind="micro">
        We identify the guideline Apple cited, quote the rule, and draft your reply — the
        recommendation is a heuristic, your call.
      </AppText>

      <TextField
        testID="ra-text"
        value={text}
        onChangeText={setText}
        placeholder="Paste the App Review rejection here…"
        multiline
      />
      <Button
        testID="ra-run"
        label="Analyze"
        variant="ghost"
        disabled={!text.trim()}
        loading={busy}
        onPress={() => void analyze()}
      />

      {error ? (
        <AppText kind="micro" testID="ra-error" style={{ color: palette.bad }}>
          {error}
        </AppText>
      ) : null}

      {result ? (
        <View testID="ra-result" style={{ marginTop: spacing.sm }}>
          {result.primaryGuideline ? (
            <AppText kind="body" testID="ra-guideline">
              Cited: Guideline {result.primaryGuideline}
              {result.guidelines.length > 1 ? ` (+ ${result.guidelines.slice(1).join(", ")})` : ""}
            </AppText>
          ) : null}

          {result.quote ? (
            <AppText kind="dim" testID="ra-quote" style={{ marginTop: spacing.xs }}>
              “{result.quote}”
            </AppText>
          ) : (
            <AppText kind="micro" testID="ra-no-quote" style={{ marginTop: spacing.xs }}>
              No quote available — we don’t hold this rule’s text. Read Apple’s message directly.
            </AppText>
          )}

          <AppText kind="micro" testID="ra-recommendation" style={{ marginTop: spacing.xs }}>
            Suggested path: {PATH_LABEL[result.recommended] ?? result.recommended} — {result.rationale}
          </AppText>

          <DraftBlock testID="ra-fix" title="Draft — fix & resubmit" body={result.drafts.fix_and_resubmit} />
          <DraftBlock testID="ra-appeal" title="Draft — appeal" body={result.drafts.appeal} />
        </View>
      ) : null}
    </Card>
  );
}
