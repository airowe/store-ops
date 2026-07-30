/**
 * The setup header — logo, title, "n / total", Skip, and the segmented progress
 * bar. Shared by every onboarding step so the chrome stays identical as the
 * flow advances.
 */
import React from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../components/primitives.js";
import { usePalette, spacing } from "../theme/index.js";
import { progressState, STEPS } from "./model.js";

export function OnboardingProgress({
  stepIndex,
  onSkip,
  onBack,
}: {
  stepIndex: number;
  onSkip: () => void;
  onBack?: () => void;
}) {
  const palette = usePalette();
  const segments = progressState(stepIndex);

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        {onBack ? (
          <Pressable onPress={onBack} testID="onb-back" accessibilityRole="button" hitSlop={8}>
            <AppText kind="mono" style={{ color: palette.dim }}>‹</AppText>
          </Pressable>
        ) : (
          <View
            testID="onb-logo"
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: palette.signalGlow,
              borderWidth: 1,
              borderColor: palette.signalDim,
            }}
          >
            <AppText kind="micro" style={{ color: palette.signal, fontWeight: "800" }}>✓</AppText>
          </View>
        )}
        <AppText kind="mono" style={{ fontWeight: "700" }}>Set up ShipASO</AppText>
        <View style={{ flex: 1 }} />
        <AppText kind="micro" testID="onb-step-count">
          {stepIndex + 1} / {STEPS.length}
        </AppText>
        <Pressable onPress={onSkip} testID="onb-skip" accessibilityRole="button" hitSlop={8}>
          <AppText kind="micro" style={{ color: palette.dim }}>Skip</AppText>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", gap: 5 }}>
        {segments.map((filled, i) => (
          <View
            key={STEPS[i]}
            testID={`onb-seg-${STEPS[i]}`}
            accessibilityState={{ selected: filled }}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 999,
              backgroundColor: filled ? palette.signal : palette.line,
            }}
          />
        ))}
      </View>
    </View>
  );
}
