/**
 * ScreenshotPlanCard (#153 ShipShots) — plan a corrected screenshot SET from the
 * run's audit findings. Interactive: pressing asks the planner (POST
 * /plan/screenshots) and renders the returned plan. It shows the PLAN, never
 * pixels — rendering is the local `render-shipshots.py` step; nothing ships from
 * here (the standing "nothing ships hosted" posture).
 *
 * Honesty, load-bearing: a MISSING shot is a labeled gap with its reason (never a
 * fabricated screen); a bad headline is a needs-review badge, not silently
 * dropped; the verbatim draft label and the `degraded` (fallback) notice are
 * always surfaced so nobody mistakes a draft/deterministic plan for a verdict.
 */
import { useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { planScreenshots } from "../api/endpoints.js";
import type { ScreenshotPlan, ScreenshotPlanInputs } from "../types/api.js";
import { palette, spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";

export function ScreenshotPlanCard({ client, inputs }: { client: ApiClient; inputs: ScreenshotPlanInputs }) {
  const [plan, setPlan] = useState<ScreenshotPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      setPlan(await planScreenshots(client, inputs));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <AppText kind="title">Plan a screenshot set</AppText>
      <AppText kind="micro">
        Turn this run’s screenshot findings into a shot-by-shot plan you render locally.
      </AppText>
      <Button testID="plan-screenshots-btn" label={busy ? "Planning…" : "Plan screenshots"} onPress={run} disabled={busy} />

      {plan ? (
        <View style={{ marginTop: spacing.sm }}>
          {plan.degraded ? (
            <AppText testID="plan-degraded" kind="micro">
              Deterministic fallback — no model shaped this plan.
            </AppText>
          ) : null}
          <AppText testID="plan-narrative" kind="micro">
            {plan.narrative}
          </AppText>

          {plan.shots.map((s, i) => (
            <View key={i} style={{ marginTop: spacing.xs }}>
              {s.sourceScreen === "MISSING" ? (
                <AppText testID={`shot-missing-${i}`} kind="micro">
                  [{s.templateId}] MISSING — {s.missingReason ?? "no captured screen"}
                </AppText>
              ) : (
                <>
                  <AppText kind="micro">{s.headline || "(no headline)"}</AppText>
                  <AppText kind="dim">[{s.templateId}] ← {s.sourceScreen}</AppText>
                </>
              )}
              {s.needsReview ? (
                <AppText testID={`shot-review-${i}`} kind="micro" style={{ color: palette.warn }}>
                  ⚠ review{s.headlineIssue ? `: ${s.headlineIssue}` : ""}
                </AppText>
              ) : null}
            </View>
          ))}

          <AppText kind="micro" style={{ marginTop: spacing.xs }}>
            {plan.label}
          </AppText>
          <AppText kind="micro">
            Render locally with render-shipshots.py, then upload with asc screenshots upload.
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}
