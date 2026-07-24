/**
 * AwaitingBanner — the dashboard's "N runs ready to review" call to action
 * (Mobile.dc.html). Amber, because an awaiting run is the one thing on this
 * screen that needs the user. Renders nothing at zero: an empty banner would be
 * noise, and a "0 runs ready" line would be a lie about there being work.
 */
import React from "react";
import { Pressable, View } from "react-native";
import { usePalette, spacing, radius } from "../theme/index.js";
import { AppText } from "./primitives.js";

export function AwaitingBanner({ count, onReview }: { count: number; onReview: () => void }) {
  const palette = usePalette();
  if (count <= 0) return null;

  return (
    <Pressable
      testID="awaiting-banner"
      accessibilityRole="button"
      onPress={onReview}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          // The palette has no warn-glow/border pair (they're web-shell-scoped),
          // so tint from `warn` itself — the panel keeps the surface legible in
          // both themes while the amber border carries the "needs you" signal.
          backgroundColor: palette.panel,
          borderColor: palette.warn,
          borderWidth: 1,
          borderRadius: radius.base,
          padding: spacing.lg,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View
        style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: palette.warn }}
        testID="awaiting-dot"
      />
      <View style={{ flex: 1 }}>
        <AppText kind="body" style={{ fontWeight: "600" }}>
          {count} {count === 1 ? "run" : "runs"} ready to review
        </AppText>
        <AppText kind="micro">Approval only reveals the push — it never ships anything.</AppText>
      </View>
      <AppText kind="mono" style={{ color: palette.warn, fontWeight: "700" }}>Review →</AppText>
    </Pressable>
  );
}
