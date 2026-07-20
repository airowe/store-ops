/**
 * LocalizationExpansionCard (PRD 04) — ROI-sorted locales to add next. Read-only:
 * a static, PII-safe heuristic ranks storefronts the app doesn't yet target. The
 * effort is labeled honestly ("translate" existing copy vs author "new" metadata)
 * so a recommendation never hides the work it implies. Absent/empty → nothing
 * renders (never a fabricated market).
 */
import { StyleSheet, View } from "react-native";
import { palette, spacing } from "../theme/index.js";
import type { LocaleRecommendation } from "../types/api.js";
import { AppText, Card } from "./primitives.js";

const EFFORT_LABEL: Record<LocaleRecommendation["effort"], string> = {
  translate: "translate existing copy",
  new: "new metadata",
};

export function LocalizationExpansionCard({
  recommendations,
}: {
  recommendations: LocaleRecommendation[] | undefined;
}) {
  if (!recommendations || recommendations.length === 0) return null;
  return (
    <Card>
      <AppText kind="lead">Locales to add next</AppText>
      <AppText kind="micro">
        Where the same listing could reach more searches — sorted by expected return. Suggestions
        only; nothing is translated until you generate a draft.
      </AppText>
      {recommendations.map((r) => (
        <View key={r.locale} style={styles.row} testID={`locale-rec-${r.locale}`}>
          <View style={{ flex: 1 }}>
            <AppText kind="body">{r.locale}</AppText>
            <AppText kind="micro">
              {r.rationale} · {EFFORT_LABEL[r.effort]}
            </AppText>
          </View>
          <AppText kind="mono" style={{ color: palette.signal }}>
            {r.storefrontTier}
          </AppText>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
});
