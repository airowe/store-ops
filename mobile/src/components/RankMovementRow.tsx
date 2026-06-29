/**
 * RankMovementRow — one keyword's week-over-week movement. Honesty rules:
 *   • measured prev → cur shows the delta + a direction chip.
 *   • single-snapshot (previous null) shows the current rank tagged "new" — NO
 *     fabricated count-up / delta.
 *   • an unchecked / unranked current reads "—", never 0.
 * (Animated count-up lives in lib/motion; this row renders the honest final
 * state, which is also what Reduce-Motion shows.)
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { palette, spacing } from "../theme/index.js";
import { formatRank } from "../lib/format.js";
import type { DeltaEntry } from "../types/api.js";
import { AppText } from "./primitives.js";

export function RankMovementRow({ entry }: { entry: DeltaEntry }) {
  const hasPrev = entry.previous != null;
  const cur = entry.current;
  const up = entry.direction === "up";
  const down = entry.direction === "down";
  const chipColor = up ? palette.signal : down ? palette.bad : palette.dim;

  return (
    <View style={styles.row} testID={`move-${entry.keyword}`}>
      <AppText kind="body" style={{ flex: 1 }} numberOfLines={1}>{entry.keyword}</AppText>
      <AppText kind="mono">{formatRank(cur)}</AppText>
      {hasPrev && entry.delta != null && entry.delta !== 0 ? (
        <AppText kind="mono" style={{ color: chipColor }}>
          {up ? "▲" : down ? "▼" : ""}{Math.abs(entry.delta)}
        </AppText>
      ) : !hasPrev && cur != null ? (
        <AppText kind="micro" style={{ color: palette.signal }}>new</AppText>
      ) : (
        <AppText kind="micro">—</AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
});
