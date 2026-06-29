/**
 * Themed primitives — the small, shared building blocks every screen composes,
 * so the dark "engineering terminal × editorial" identity is applied once. Pure
 * presentational components over the static theme tokens.
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { fontSize, palette, radius, spacing } from "../theme/index.js";

/** A full-screen, padded, scrollable surface on the app background. */
export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.screenContent, style]}>
      {children}
    </ScrollView>
  );
}

type TextKind = "display" | "title" | "lead" | "body" | "dim" | "mono" | "micro";

const TEXT_STYLE: Record<TextKind, TextStyle> = {
  display: { color: palette.ink, fontSize: fontSize.display, fontWeight: "700" },
  title: { color: palette.ink, fontSize: fontSize.title, fontWeight: "700" },
  lead: { color: palette.ink, fontSize: fontSize.lead, fontWeight: "600" },
  body: { color: palette.ink, fontSize: fontSize.body },
  dim: { color: palette.dim, fontSize: fontSize.small },
  mono: { color: palette.ink, fontSize: fontSize.small, fontFamily: "monospace" },
  micro: { color: palette.faint, fontSize: fontSize.micro },
};

export function AppText({
  kind = "body",
  children,
  style,
  numberOfLines,
  selectable,
}: {
  kind?: TextKind;
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
}) {
  return (
    <Text style={[TEXT_STYLE[kind], style]} numberOfLines={numberOfLines} selectable={selectable}>
      {children}
    </Text>
  );
}

/** A bordered panel card. */
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const isPrimary = variant === "primary";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonGhost,
        (disabled || loading) && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? palette.bg : palette.signal} />
      ) : (
        <Text style={[styles.buttonLabel, isPrimary ? styles.buttonLabelPrimary : styles.buttonLabelGhost]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  screenContent: { padding: spacing.lg, gap: spacing.md },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md, backgroundColor: palette.bg },
  card: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: radius.base,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  button: { borderRadius: radius.base, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", minHeight: 48 },
  buttonPrimary: { backgroundColor: palette.signal },
  buttonGhost: { backgroundColor: "transparent", borderColor: palette.line, borderWidth: 1 },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonLabel: { fontSize: fontSize.body, fontWeight: "700" },
  buttonLabelPrimary: { color: palette.bg },
  buttonLabelGhost: { color: palette.signal },
});
