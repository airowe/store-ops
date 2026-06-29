/**
 * AppCard — one connected app on the dashboard: identity, latest-run badge, lead
 * rank, and the findings summary. Honest rendering throughout: an unmeasured rank
 * is "—" (never a guessed number), and the findings badge only appears when the
 * server actually returned a summary.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { palette, radius, spacing } from "../theme/index.js";
import { formatRank, humanizeStatus, timeAgo } from "../lib/format.js";
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
  const rank = app.rank_summary;
  const findings = app.findings_summary;
  return (
    <Pressable accessibilityRole="button" testID={`app-card-${app.id}`} onPress={() => onPress(app.id)}>
      <Card>
        <View style={styles.headerRow}>
          <AppText kind="lead" numberOfLines={1}>{app.name}</AppText>
          {app.latest_run ? <StatusBadge status={app.latest_run.status} /> : null}
        </View>
        <AppText kind="dim" numberOfLines={1}>{app.bundle_id}</AppText>

        <View style={styles.metaRow}>
          {rank ? (
            <AppText kind="mono">
              {rank.lead_keyword}: <AppText kind="mono" style={{ color: palette.signal }}>{formatRank(rank.lead_rank)}</AppText>
            </AppText>
          ) : (
            <AppText kind="micro">no ranks checked yet</AppText>
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
      </Card>
    </Pressable>
  );
}

function StatusBadge({ status }: { status: string }) {
  const awaiting = status === "awaiting_approval";
  return (
    <View style={[styles.badge, awaiting ? styles.badgeWarn : styles.badgeDim]}>
      <AppText kind="micro" style={{ color: awaiting ? palette.bg : palette.dim }}>
        {humanizeStatus(status)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginTop: spacing.xs },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.base, maxWidth: 160 },
  badgeWarn: { backgroundColor: palette.warn },
  badgeDim: { backgroundColor: palette.panel2, borderColor: palette.line, borderWidth: 1 },
});
