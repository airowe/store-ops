/**
 * Themed primitives — the small, shared building blocks every screen composes,
 * so the "engineering terminal × editorial" identity is applied once. These read
 * the LIVE palette via `usePalette()`, so they track light/dark automatically;
 * they are the reference pattern for migrating the remaining components off the
 * static `palette` import.
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
import { fontSize, radius, spacing } from "../theme/index.js";
import { usePalette } from "../theme/index.js";
import type { Palette } from "../theme/index.js";
import { useLayout } from "../theme/responsive.js";

/**
 * A full-screen, padded, scrollable surface. On tablets the content column is
 * capped (`contentMaxWidth`) and centered — mirroring the web's `.wrap` — so an
 * iPad never stretches a single column into unreadable full-width lines. Pass
 * `wide` for the rare screen that wants the whole canvas.
 */
export function Screen({
  children,
  style,
  wide,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  wide?: boolean;
}) {
  const palette = usePalette();
  const { contentMaxWidth, gutter } = useLayout();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={styles.screenOuter}>
      <View
        testID="screen-content"
        style={[
          { padding: gutter, gap: gutter },
          !wide && { maxWidth: contentMaxWidth, width: "100%", alignSelf: "center" },
          style,
        ]}
      >
        {children}
      </View>
    </ScrollView>
  );
}

type TextKind = "display" | "title" | "lead" | "body" | "dim" | "mono" | "micro";

/** Per-kind styles that depend on the live palette (color) + static scale. */
function textStyle(palette: Palette, kind: TextKind): TextStyle {
  switch (kind) {
    case "display": return { color: palette.ink, fontSize: fontSize.display, fontWeight: "700" };
    case "title":   return { color: palette.ink, fontSize: fontSize.title, fontWeight: "700" };
    case "lead":    return { color: palette.ink, fontSize: fontSize.lead, fontWeight: "600" };
    case "body":    return { color: palette.ink, fontSize: fontSize.body };
    case "dim":     return { color: palette.dim, fontSize: fontSize.small };
    case "mono":    return { color: palette.ink, fontSize: fontSize.small, fontFamily: "monospace" };
    case "micro":   return { color: palette.faint, fontSize: fontSize.micro };
  }
}

export function AppText({
  kind = "body",
  children,
  style,
  numberOfLines,
  selectable,
  testID,
}: {
  kind?: TextKind;
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
  testID?: string;
}) {
  const palette = usePalette();
  return (
    <Text style={[textStyle(palette, kind), style]} numberOfLines={numberOfLines} selectable={selectable} testID={testID}>

      {children}
    </Text>
  );
}

/** A bordered panel card. */
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: palette.panel,
          borderColor: palette.line,
          borderWidth: 1,
          borderRadius: radius.base,
          padding: spacing.lg,
          gap: spacing.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
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
  const palette = usePalette();
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
        isPrimary
          ? { backgroundColor: palette.signal }
          : { backgroundColor: "transparent", borderColor: palette.line, borderWidth: 1 },
        (disabled || loading) && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? palette.bg : palette.signal} />
      ) : (
        <Text style={[styles.buttonLabel, { color: isPrimary ? palette.bg : palette.signal }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  return <View style={[styles.centered, { backgroundColor: palette.bg }]}>{children}</View>;
}

const styles = StyleSheet.create({
  // Outer container fills width so the inner column can center on wide screens.
  screenOuter: { flexGrow: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  button: { borderRadius: radius.base, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", minHeight: 48 },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonLabel: { fontSize: fontSize.body, fontWeight: "700" },
});
