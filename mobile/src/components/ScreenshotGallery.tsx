/**
 * ScreenshotGallery + LeverList — the screenshot grade, the REAL shots, and the
 * quantified C→B→A levers.
 *
 * Honesty gates (mirroring the engine + web):
 *   • an unreadable/unknown set (grade "?", score null) renders NO gallery — an
 *     explicit empty state, never a fake/placeholder grid.
 *   • the levers panel is absent for the "?" set AND for an A-grade set (no
 *     headroom) — we never over-sell a finished or unknown listing.
 */
import React from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { palette, radius, spacing } from "../theme/index.js";
import type { Lever, ShotScore } from "../types/api.js";
import { AppText, Card } from "./primitives.js";

export function ScreenshotGallery({ shots }: { shots: ShotScore | null | undefined }) {
  // No score / "?" grade → unreadable/unknown. Honest empty state, no gallery.
  if (!shots || shots.score == null || shots.grade === "?") {
    return (
      <Card>
        <AppText kind="lead">Screenshots</AppText>
        <AppText kind="dim">Couldn’t read this app’s screenshots — grade unknown (not a zero).</AppText>
      </Card>
    );
  }

  const urls = [...(shots.screenshotUrls ?? []), ...(shots.ipadScreenshotUrls ?? [])];
  return (
    <Card>
      <View style={styles.headerRow}>
        <AppText kind="lead">Screenshots</AppText>
        <GradePill grade={shots.grade} score={shots.score} />
      </View>
      {shots.aspectHint ? <AppText kind="micro">{shots.aspectHint}</AppText> : null}

      {urls.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {urls.map((u, i) => (
            <Image key={`${u}-${i}`} testID="shot" source={{ uri: u }} style={styles.shot} resizeMode="cover" />
          ))}
        </ScrollView>
      ) : (
        <AppText kind="dim">No screenshots on this listing.</AppText>
      )}

      <LeverList levers={shots.levers} grade={shots.grade} />
    </Card>
  );
}

/** Levers — hidden for an A grade (no headroom) and when empty. */
function LeverList({ levers, grade }: { levers: Lever[] | undefined; grade: string }) {
  if (grade === "A" || grade === "?" || !levers || levers.length === 0) return null;
  return (
    <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
      <AppText kind="dim">Raise the grade</AppText>
      {levers.map((l) => (
        <View key={l.id} style={styles.lever} testID={`lever-${l.id}`}>
          <AppText kind="body" style={{ flex: 1 }}>{l.label}</AppText>
          <AppText kind="mono" style={{ color: palette.signal }}>+{l.delta} → {l.toGrade}</AppText>
        </View>
      ))}
    </View>
  );
}

function GradePill({ grade, score }: { grade: string; score: number }) {
  return (
    <View style={styles.pill}>
      <AppText kind="mono" style={{ color: palette.signal }}>{grade} · {score}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  strip: { gap: spacing.sm, paddingVertical: spacing.sm },
  shot: { width: 120, height: 240, borderRadius: radius.base, backgroundColor: palette.panel2, borderColor: palette.line, borderWidth: 1 },
  pill: { backgroundColor: palette.panel2, borderColor: palette.line, borderWidth: 1, borderRadius: radius.base, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  lever: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
});
