/**
 * FindingCard + SurfaceLock — the run's findings and capability locks.
 *
 * A Finding is an actionable issue (severity-tinted). A SurfaceLock is NOT a
 * deficiency: it's a surface the run couldn't read ("connect to unlock"), framed
 * as an opportunity — never counted as a problem. Keeping them visually distinct
 * upholds the honesty model (a lock is a capability gap, not a failing grade).
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { palette, radius, spacing } from "../theme/index.js";
import type { Finding, FindingSeverity, SurfaceLock } from "../types/api.js";
import { AppText, Card } from "./primitives.js";

const SEVERITY_COLOR: Record<FindingSeverity, string> = {
  critical: palette.bad,
  warn: palette.warn,
  good: palette.signal,
  info: palette.dim,
};

export function FindingCard({ finding }: { finding: Finding }) {
  const color = SEVERITY_COLOR[finding.severity];
  return (
    <Card style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <AppText kind="lead" style={{ flex: 1 }}>{finding.title}</AppText>
        <AppText kind="micro" style={{ color }}>{finding.severity.toUpperCase()}</AppText>
      </View>
      <AppText kind="body">{finding.detail}</AppText>
      <AppText kind="dim" style={{ color: palette.signal }}>Fix: {finding.fix}</AppText>
      {finding.evidence ? <AppText kind="micro">{finding.evidence}</AppText> : null}
    </Card>
  );
}

export function SurfaceLockCard({ lock }: { lock: SurfaceLock }) {
  return (
    <Card style={styles.lock}>
      <View style={styles.row}>
        <AppText kind="lead" style={{ flex: 1 }}>🔒 {lock.label}</AppText>
      </View>
      <AppText kind="dim">{lock.unlockCopy}</AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  lock: { borderStyle: "dashed", borderColor: palette.line, borderRadius: radius.base },
});
