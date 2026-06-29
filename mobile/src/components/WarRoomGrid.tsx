/**
 * WarRoomGrid — head-to-head keyword ranks vs selected competitors. Honesty: a
 * competitor we never checked renders "—" (never a guessed number); a keyword you
 * win is tinted with the signal accent. Your rank shows its final value (the
 * count-up animation is a motion concern; this renders the honest end state).
 */
import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { palette, spacing } from "../theme/index.js";
import { formatRank } from "../lib/format.js";
import type { HeadToHead } from "../types/api.js";
import { AppText, Card } from "./primitives.js";

export function WarRoomGrid({ rows, competitors }: { rows: HeadToHead[]; competitors: string[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <AppText kind="lead">War room</AppText>
        <AppText kind="dim">No head-to-head data yet.</AppText>
      </Card>
    );
  }
  return (
    <Card>
      <AppText kind="lead">War room</AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.row, styles.headerRow]}>
            <AppText kind="micro" style={styles.kwCol}>keyword</AppText>
            <AppText kind="micro" style={styles.cell}>you</AppText>
            {competitors.map((c) => (
              <AppText key={c} kind="micro" style={styles.cell} numberOfLines={1}>{c}</AppText>
            ))}
          </View>
          {rows.map((r) => (
            <View key={r.keyword} style={styles.row} testID={`war-${r.keyword}`}>
              <AppText kind="body" style={styles.kwCol} numberOfLines={1}>{r.keyword}</AppText>
              <AppText kind="mono" style={[styles.cell, r.winning ? { color: palette.signal } : undefined]}>
                {formatRank(r.you)}
              </AppText>
              {competitors.map((name) => {
                const c = r.competitors.find((x) => x.name === name);
                return (
                  <AppText key={name} kind="mono" style={styles.cell}>
                    {formatRank(c?.rank ?? null)}
                  </AppText>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.xs, gap: spacing.sm },
  headerRow: { borderBottomColor: palette.line, borderBottomWidth: 1 },
  kwCol: { width: 120 },
  cell: { width: 84, textAlign: "right" },
});
