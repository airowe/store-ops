/**
 * PortfolioRow + TierBadge — the Scale-tier roll-up. Honest: an unaudited app
 * shows a "—" grade, an untracked app shows "—" rank (never a guessed value).
 */
import React, { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { radius, spacing, usePalette, type Palette } from "../theme/index.js";
import { formatRank } from "../lib/format.js";
import type { PortfolioCard } from "../types/api.js";
import { AppText, Card } from "./primitives.js";

export function PortfolioRow({ card, onPress }: { card: PortfolioCard; onPress: (id: string) => void }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <Pressable testID={`portfolio-${card.appId}`} onPress={() => onPress(card.appId)}>
      <Card>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <AppText kind="lead" numberOfLines={1}>{card.name}</AppText>
            <AppText kind="micro">
              {card.leadKeyword ? `${card.leadKeyword}: ${formatRank(card.leadRank)}` : "no tracked keyword"}
              {card.pendingApproval ? " · awaiting approval" : ""}
            </AppText>
          </View>
          <TierBadge label={card.grade ?? "—"} highlight={card.grade === "A"} />
        </View>
      </Card>
    </Pressable>
  );
}

function TierBadge({ label, highlight }: { label: string; highlight?: boolean }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={[styles.badge, highlight ? styles.badgeHi : undefined]}>
      <AppText kind="mono" style={{ color: highlight ? palette.bg : palette.ink }}>{label}</AppText>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    badge: { minWidth: 40, alignItems: "center", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.base, backgroundColor: p.panel2, borderColor: p.line, borderWidth: 1 },
    badgeHi: { backgroundColor: p.signal, borderColor: p.signal },
  });
