/**
 * FindingCard + SurfaceLock — the run's findings and capability locks.
 *
 * A Finding is an actionable issue (severity-tinted). A SurfaceLock is NOT a
 * deficiency: it's a surface the run couldn't read ("connect to unlock"), framed
 * as an opportunity — never counted as a problem. Keeping them visually distinct
 * upholds the honesty model (a lock is a capability gap, not a failing grade).
 */
import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { radius, spacing, usePalette, type Palette } from "../theme/index.js";
import type { Finding, FindingSeverity, SurfaceLock } from "../types/api.js";
import { AppText, Card } from "./primitives.js";

/**
 * Severity → colour, resolved against the LIVE palette. A module-scope constant
 * map would freeze the dark values, so this takes the palette as an argument —
 * the same reason styles go through `makeStyles`.
 */
const severityColor = (p: Palette, severity: FindingSeverity): string =>
  ({ critical: p.bad, warn: p.warn, good: p.signal, info: p.dim })[severity];

export function FindingCard({ finding }: { finding: Finding }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const color = severityColor(palette, finding.severity);
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
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <Card style={styles.lock}>
      <View style={styles.row}>
        <AppText kind="lead" style={{ flex: 1 }}>🔒 {lock.label}</AppText>
      </View>
      <AppText kind="dim">{lock.unlockCopy}</AppText>
    </Card>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    dot: { width: 8, height: 8, borderRadius: 4 },
    lock: { borderStyle: "dashed", borderColor: p.line, borderRadius: radius.base },
  });
