/**
 * TextField — the themed text input used across forms (login, connect, paste).
 * A thin wrapper over RN TextInput with the dark palette + consistent sizing.
 */
import React from "react";
import { StyleSheet, TextInput, type KeyboardTypeOptions } from "react-native";
import { fontSize, palette, radius, spacing } from "../theme/index.js";

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

const styles = StyleSheet.create({
  input: {
    color: palette.ink,
    backgroundColor: palette.bg2,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: radius.base,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.body,
    minHeight: 48,
  },
  multiline: { minHeight: 120, textAlignVertical: "top" },
});
