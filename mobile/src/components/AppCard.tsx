/**
 * AppCard — one connected app on the dashboard: identity, latest-run badge, lead
 * rank, and the findings summary. Honest rendering throughout: an unmeasured rank
 * is "—" (never a guessed number), and the findings badge only appears when the
 * server actually returned a summary.
 */
import React, { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { radius, spacing, usePalette, type Palette } from "../theme/index.js";
import { formatRank, humanizeStatus, timeAgo } from "../lib/format.js";
import { recordedProposalsLabel } from "../lib/recordedProposals.js";
import type { AppListItem } from "../types/api.js";
import { AppText, Card } from "./primitives.js";

export function AppCard({
  app,
  now,
  onPress,
}: {
  app: AppListItem;
  now: number;
  onPress: (id: string) => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const rank = app.rank_summary;
  const findings = app.findings_summary;
  const recorded = recordedProposalsLabel(app);
  return (
    <Pressable accessibilityRole="button" testID={`app-card-${app.id}`} onPress={() => onPress(app.id)}>
      <Card>
        <View style={styles.headerRow}>
          <View style={styles.iconChip} testID={`app-chip-${app.id}`}>
            <AppText kind="lead" style={{ color: palette.signal, fontWeight: "700" }}>
              {(app.name.trim()[0] ?? "·").toUpperCase()}
            </AppText>
          </View>
          <View style={styles.identity}>
            <AppText kind="lead" numberOfLines={1}>{app.name}</AppText>
            <AppText kind="dim" numberOfLines={1}>{app.bundle_id}</AppText>
          </View>
          {app.latest_run ? <StatusBadge status={app.latest_run.status} /> : null}
        </View>

        {/* divider row — the keyword and its rank, the two facts worth a glance */}
        <View style={styles.rankRow}>
          {rank ? (
            <>
              <AppText kind="dim" numberOfLines={1} style={{ flex: 1 }}>{rank.lead_keyword}</AppText>
              <AppText kind="mono" style={{ color: palette.signal, fontWeight: "700" }}>
                {formatRank(rank.lead_rank)}
              </AppText>
            </>
          ) : (
            <AppText kind="micro" style={{ flex: 1 }}>no ranks checked yet</AppText>
          )}
          {app.latest_run ? (
            <AppText kind="micro">{timeAgo(app.latest_run.created_at, now)}</AppText>
          ) : null}
        </View>

        {findings ? (
          <AppText kind="dim" style={{ color: findings.critical > 0 ? palette.bad : palette.dim }}>
            {findings.label}
          </AppText>
        ) : null}

        {/* #493: the quiet week's output, said once. Absent when zero or unknown. */}
        {recorded ? (
          <AppText kind="micro" testID={`recorded-proposals-${app.id}`}>{recorded}</AppText>
        ) : null}
      </Card>
    </Pressable>
  );
}

function StatusBadge({ status }: { status: string }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const awaiting = status === "awaiting_approval";
  return (
    <View style={[styles.badge, awaiting ? styles.badgeWarn : styles.badgeDim]}>
      <AppText kind="micro" style={{ color: awaiting ? palette.bg : palette.dim }}>
        {humanizeStatus(status)}
      </AppText>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    identity: { flex: 1, minWidth: 0 },
    iconChip: {
      width: 42, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center",
      backgroundColor: p.signalGlow, borderColor: p.signalDim, borderWidth: 1,
    },
    rankRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm,
      marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: p.lineSoft,
    },
    badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.base, maxWidth: 160 },
    badgeWarn: { backgroundColor: p.warn },
    badgeDim: { backgroundColor: p.panel2, borderColor: p.line, borderWidth: 1 },
  });
