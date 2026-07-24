/**
 * Step 3 — confirm rivals. Prior answers stay visible as pinned chips at the
 * top (the progressive-disclosure promise), then the confirmed rivals (each
 * removable) and the keyword-derived suggestions. Only confirmed rivals feed
 * runs — the helper says so, because a silently-watched competitor would be a
 * lie about what the agent is doing.
 */
import React from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../components/primitives.js";
import { usePalette, spacing } from "../theme/index.js";
import { answerChips, type OnboardingState } from "./model.js";

export function RivalsStep({
  state,
  onAdd,
  onRemove,
}: {
  state: OnboardingState;
  onAdd: (rival: string) => void;
  onRemove: (rival: string) => void;
}) {
  const palette = usePalette();
  const pinned = answerChips(state);

  return (
    <View style={{ gap: spacing.md }}>
      {pinned.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg }}>
          {pinned.map((label) => (
            <View
              key={label}
              testID={`onb-answer-${label}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingVertical: 5,
                paddingHorizontal: 10,
                borderRadius: 999,
                backgroundColor: palette.bg,
                borderWidth: 1,
                borderColor: palette.lineSoft,
              }}
            >
              <AppText kind="micro" style={{ color: palette.signal }}>✓</AppText>
              <AppText kind="micro" style={{ color: palette.dim }}>{label}</AppText>
            </View>
          ))}
        </View>
      ) : null}

      <AppText kind="title" testID="onb-question" style={{ marginTop: spacing.md }}>
        Who are your top rivals?
      </AppText>
      <AppText kind="dim">
        Only confirmed rivals feed your runs. We suggested a few from your keywords.
      </AppText>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
        {state.rivals.map((r) => (
          <Pressable
            key={r}
            testID={`onb-rival-${r}`}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${r}`}
            onPress={() => onRemove(r)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              paddingVertical: 8,
              paddingHorizontal: 13,
              borderRadius: 999,
              backgroundColor: palette.signalGlow,
              borderWidth: 1,
              borderColor: palette.signalDim,
            }}
          >
            <AppText kind="mono" style={{ color: palette.signal }}>{r}</AppText>
            <AppText kind="mono" style={{ color: palette.faint }}>×</AppText>
          </Pressable>
        ))}
      </View>

      {state.suggested.length ? (
        <>
          <AppText kind="micro" style={{ marginTop: spacing.sm }}>Suggested from your keywords</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {state.suggested.map((s) => (
              <Pressable
                key={s}
                testID={`onb-suggest-${s}`}
                accessibilityRole="button"
                onPress={() => onAdd(s)}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 13,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: palette.line,
                }}
              >
                <AppText kind="mono" style={{ color: palette.dim }}>+ {s}</AppText>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}
