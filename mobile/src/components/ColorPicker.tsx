/**
 * ColorPicker — the user's brand colors for a screenshot set. Picks flow into
 * the plan request as `brandPalette`: the planner only ever assigns accents
 * FROM this list (a free-form model accent is coerced to the first pick), and
 * the renderer applies an accent only where its contrast against the solid
 * background measures readable — so a pick here can suggest a color, never
 * force an unreadable one onto pixels.
 *
 * No picks = no palette on the wire = today's neutral behavior. First pick is
 * the primary (the coercion fallback). Custom colors join by hex — a malformed
 * hex is refused with the reason, never quietly dropped or "corrected".
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import { EXAMPLE_HEX, MAX_COLORS, SWATCHES, normalizeBrandHex } from "../lib/brandSwatches.js";
import { spacing, usePalette } from "../theme/index.js";
import { AppText, Button } from "./primitives.js";
import { TextField } from "./TextField.js";

export { MAX_COLORS, SWATCHES };

export function ColorPicker({
  colors,
  onChange,
}: {
  colors: string[];
  onChange: (colors: string[]) => void;
}) {
  const palette = usePalette();
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const toggle = (hex: string) => {
    setNote(null);
    if (colors.includes(hex)) {
      onChange(colors.filter((c) => c !== hex));
    } else if (colors.length >= MAX_COLORS) {
      setNote(`Up to ${MAX_COLORS} colors — remove one first.`);
    } else {
      onChange([...colors, hex]);
    }
  };

  const addCustom = () => {
    const normalized = normalizeBrandHex(custom);
    if (normalized === null) {
      setNote(`“${custom.trim()}” isn’t a #rrggbb color.`);
      return;
    }
    setCustom("");
    toggle(normalized);
  };

  const options = [...SWATCHES, ...colors.filter((c) => !(SWATCHES as readonly string[]).includes(c))];

  return (
    <View testID="color-picker" style={{ marginTop: spacing.sm }}>
      <AppText kind="micro">Brand colors</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs }}>
        {options.map((hex) => {
          const pos = colors.indexOf(hex);
          return (
            <Pressable
              key={hex}
              testID={`color-${hex.slice(1)}`}
              accessibilityRole="button"
              accessibilityLabel={`brand color ${hex}`}
              accessibilityState={{ selected: pos >= 0 }}
              onPress={() => toggle(hex)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                backgroundColor: hex,
                borderWidth: 2,
                borderColor: pos >= 0 ? palette.signal : palette.line,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {pos === 0 ? (
                <AppText testID="color-primary-badge" kind="micro" style={{ color: palette.onAccent }}>
                  1
                </AppText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: spacing.xs, alignItems: "center", marginTop: spacing.xs }}>
        <View style={{ flex: 1 }}>
          <TextField
            testID="color-custom-hex"
            value={custom}
            onChangeText={setCustom}
            placeholder={EXAMPLE_HEX}
            onSubmitEditing={addCustom}
          />
        </View>
        <Button testID="color-custom-add" label="Add" variant="ghost" onPress={addCustom} />
      </View>
      <AppText kind="micro" style={{ marginTop: spacing.xs }}>
        {colors.length === 0
          ? "No colors picked — the set stays neutral."
          : `First pick is the primary accent. Unreadable combinations never render.`}
      </AppText>
      {note ? (
        <AppText testID="color-note" kind="micro">
          {note}
        </AppText>
      ) : null}
    </View>
  );
}
