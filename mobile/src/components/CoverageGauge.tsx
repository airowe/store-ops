/**
 * CoverageGauge — metadata budget efficiency (PRD 03). Shows the coverage score,
 * per-field fill, and itemized waste. Honesty: an UNSEEN field (`seen:false`)
 * reads "UNKNOWN", never a false 0/limit — the same discipline as the engine.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { palette, radius, spacing } from "../theme/index.js";
import type { CoverageReport } from "../types/api.js";
import { AppText, Card } from "./primitives.js";

export function CoverageGauge({ coverage }: { coverage: CoverageReport }) {
  return (
    <Card>
      <View style={styles.headerRow}>
        <AppText kind="lead">Metadata coverage</AppText>
        <AppText kind="mono" style={{ color: palette.signal }}>{coverage.coverageScore}/100</AppText>
      </View>
      <AppText kind="micro">{coverage.distinctTerms} distinct ranking terms</AppText>

      <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
        {coverage.fieldFill.map((f) => (
          <View key={f.field} style={styles.fieldRow} testID={`fill-${f.field}`}>
            <AppText kind="body" style={{ width: 90 }}>{f.field}</AppText>
            {f.seen ? (
              <>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.min(100, f.fillPct)}%` }]} />
                </View>
                <AppText kind="mono">{f.used}/{f.limit}</AppText>
              </>
            ) : (
              <AppText kind="dim" style={{ flex: 1 }}>UNKNOWN (not read)</AppText>
            )}
          </View>
        ))}
      </View>

      {coverage.waste.length > 0 ? (
        <View style={{ gap: 2, marginTop: spacing.sm }}>
          <AppText kind="dim">Wasted budget</AppText>
          {coverage.waste.map((w, i) => (
            <AppText key={i} kind="micro">• {w.detail}</AppText>
          ))}
        </View>
      ) : (
        <AppText kind="micro" style={{ marginTop: spacing.sm }}>No wasted characters — clean.</AppText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: palette.panel2, borderColor: palette.line, borderWidth: 1, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: palette.signal, borderRadius: 4 },
});
