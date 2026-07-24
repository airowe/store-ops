/**
 * Step 1 — pick a store. Two large choice buttons (the full-bleed mobile
 * treatment: one decision per screen, thumb-sized targets), App Store first
 * with the signal border since it's the primary lane today.
 */
import React from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../components/primitives.js";
import { usePalette, spacing, fontSize } from "../theme/index.js";
import type { Store } from "./model.js";

function Choice({
  testID,
  mark,
  markColor,
  markBg,
  markBorder,
  title,
  detail,
  highlighted,
  onPress,
}: {
  testID: string;
  mark: string;
  markColor: string;
  markBg: string;
  markBorder: string;
  title: string;
  detail: string;
  highlighted?: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          backgroundColor: palette.panel,
          borderWidth: 1,
          borderColor: highlighted ? palette.signalDim : palette.line,
          borderRadius: 16,
          padding: spacing.lg,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 11,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: markBg,
          borderWidth: 1,
          borderColor: markBorder,
        }}
      >
        <AppText kind="lead" style={{ color: markColor, fontWeight: "700" }}>{mark}</AppText>
      </View>
      <View style={{ flex: 1 }}>
        <AppText kind="body" style={{ fontWeight: "600" }}>{title}</AppText>
        <AppText kind="dim" style={{ marginTop: 2 }}>{detail}</AppText>
      </View>
      <AppText style={{ color: highlighted ? palette.signal : palette.faint, fontSize: fontSize.body }}>→</AppText>
    </Pressable>
  );
}

export function StoreStep({ onChoose }: { onChoose: (store: Store) => void }) {
  const palette = usePalette();
  return (
    <View style={{ gap: spacing.md }}>
      <AppText kind="title" testID="onb-question" style={{ marginTop: spacing.xl }}>
        Which store should we start with?
      </AppText>
      <AppText kind="dim" style={{ marginBottom: spacing.md }}>
        You can add the other later. We’ll audit on real data either way — no credentials needed to
        start.
      </AppText>

      <Choice
        testID="onb-store-app-store"
        mark="A"
        markColor={palette.brand}
        markBg={palette.panel}
        markBorder={palette.line}
        title="App Store"
        detail="iOS · organic rank on free iTunes data"
        highlighted
        onPress={() => onChoose("app-store")}
      />
      <Choice
        testID="onb-store-google-play"
        mark="▶"
        markColor={palette.signal}
        markBg={palette.signalGlow}
        markBorder={palette.signalDim}
        title="Google Play"
        detail="Android · the lane nobody else optimizes"
        onPress={() => onChoose("google-play")}
      />
    </View>
  );
}
