/**
 * TextField — the themed text input used across forms (login, connect, paste).
 * A thin wrapper over RN TextInput with the live palette + consistent sizing.
 */
import React, { useMemo } from "react";
import { StyleSheet, TextInput, type KeyboardTypeOptions } from "react-native";
import { fontSize, radius, spacing, typeface, usePalette, type Palette } from "../theme/index.js";

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    input: {
      color: p.ink,
      backgroundColor: p.bg2,
      borderColor: p.line,
      borderWidth: 1,
      borderRadius: radius.base,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: fontSize.body,
      fontFamily: typeface.sans,
      minHeight: 48,
    },
    multiline: { minHeight: 120, textAlignVertical: "top" },
  });

export function TextField({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize = "none",
  autoCorrect = false,
  secureTextEntry,
  multiline,
  onSubmitEditing,
  testID,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  secureTextEntry?: boolean;
  multiline?: boolean;
  onSubmitEditing?: () => void;
  testID?: string;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={palette.faint}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      secureTextEntry={secureTextEntry}
      multiline={multiline}
      onSubmitEditing={onSubmitEditing}
      style={[styles.input, multiline && styles.multiline]}
    />
  );
}
