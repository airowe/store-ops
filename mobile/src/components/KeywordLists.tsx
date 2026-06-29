/**
 * KeywordGapList + OpportunityList — the "where to push next" cards (PRD 01/06).
 * Honest: an unmeasured rank is "—" (never a guessed number); reachability is
 * labeled, not hidden, so a longshot reads as a longshot.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { palette, spacing } from "../theme/index.js";
import { formatRank } from "../lib/format.js";
import type { KeywordGap, Opportunity } from "../types/api.js";
import { AppText, Card } from "./primitives.js";

export function KeywordGapList({ gaps }: { gaps: KeywordGap[] | undefined }) {
  if (!gaps || gaps.length === 0) return null;
  return (
    <Card>
      <AppText kind="lead">Keyword opportunities</AppText>
      {gaps.map((g) => (
        <View key={g.keyword} style={styles.row} testID={`gap-${g.keyword}`}>
          <View style={{ flex: 1 }}>
            <AppText kind="body">{g.keyword}</AppText>
            <AppText kind="micro">
              you: {formatRank(g.youRank)} · {g.competitorsUsing.length} competitor{g.competitorsUsing.length === 1 ? "" : "s"} use it
              {g.inYourMetadata ? " · already in your metadata" : ""}
            </AppText>
          </View>
          <AppText kind="mono" style={{ color: palette.signal }}>{g.score}</AppText>
        </View>
      ))}
    </Card>
  );
}

export function OpportunityList({ opportunities }: { opportunities: Opportunity[] | undefined }) {
  if (!opportunities || opportunities.length === 0) return null;
  return (
    <Card>
      <AppText kind="lead">Winnable rankings</AppText>
      {opportunities.map((o) => (
        <View key={o.keyword} style={styles.row} testID={`opp-${o.keyword}`}>
          <View style={{ flex: 1 }}>
            <AppText kind="body">{o.keyword} · {formatRank(o.rank)}</AppText>
            <AppText kind="micro">{o.why} · {o.reachability}</AppText>
          </View>
          <AppText kind="mono" style={{ color: palette.signal }}>{o.opportunityScore}</AppText>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
});
