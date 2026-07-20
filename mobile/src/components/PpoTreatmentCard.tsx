/**
 * PpoTreatmentCard (#182 Phase 3) — "Run a free A/B test." A read-only brief:
 * the proposed outcome-led screenshot treatment + the steps to run Apple's free
 * Product Page Optimization test in App Store Connect YOURSELF. Present only on a
 * keyed run with no PPO test currently running; the server computes + serves it.
 *
 * Honesty, load-bearing:
 *   • it's a RECOMMENDATION the user runs in ASC — not an automated experiment;
 *   • the evidence line is a CITED public PPO result, never a claim about your
 *     numbers;
 *   • the run-length/confidence guidance is shown verbatim so nobody reads an
 *     early result as a verdict;
 *   • the ASC deep link only renders when the server knew the app id.
 */
import { View } from "react-native";
import * as Linking from "expo-linking";
import type { PpoTreatmentPlan } from "../types/api.js";
import { spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";

export function PpoTreatmentCard({ plan }: { plan: PpoTreatmentPlan }) {
  return (
    <Card>
      <View testID="ppo-treatment-card" style={{ gap: spacing.xs }}>
        <AppText kind="lead">{plan.headline}</AppText>
        <AppText kind="micro">
          A brief you run in App Store Connect — not an automated test. Set up Apple’s free A/B test
          yourself; nothing here writes to your listing.
        </AppText>
        <View testID="ppo-steps" style={{ gap: spacing.xs, marginTop: spacing.xs }}>
          {plan.steps.map((s, i) => (
            <AppText key={i} kind="body" testID={`ppo-step-${i}`}>
              {i + 1}. {s}
            </AppText>
          ))}
        </View>
        <AppText kind="dim" testID="ppo-evidence" style={{ marginTop: spacing.xs }}>
          {plan.evidence}
        </AppText>
        <AppText kind="micro" testID="ppo-guidance">
          {plan.guidance}
        </AppText>
        {plan.ascUrl ? (
          <Button
            testID="ppo-asc-link"
            label="Set it up in App Store Connect ↗"
            variant="ghost"
            onPress={() => void Linking.openURL(plan.ascUrl!)}
          />
        ) : null}
      </View>
    </Card>
  );
}
