/**
 * Grid — lay a list of cards into `columns` even columns with a gap, so card
 * lists (dashboard, portfolio) use an iPad's width instead of one tall column.
 * On phones `columns` is 1 (a plain stack). The last row's empty cells are filled
 * with flex spacers so a lone card doesn't stretch to full row width.
 *
 * Prop-driven (the screen passes `columns` from `useLayout`), so it renders
 * deterministically in tests without a window size.
 */
import React from "react";
import { View } from "react-native";
import { chunk } from "../theme/responsive.js";
import { spacing } from "../theme/index.js";

export function Grid({
  columns,
  gap = spacing.md,
  children,
}: {
  columns: number;
  gap?: number;
  children: React.ReactNode;
}) {
  const items = React.Children.toArray(children);
  const cols = Math.max(1, columns);
  const rows = chunk(items, cols);

  return (
    <View style={{ gap }}>
      {rows.map((row, r) => (
        <View key={r} testID="grid-row" style={{ flexDirection: "row", gap }}>
          {row.map((child, c) => (
            <View key={c} style={{ flex: 1 }}>
              {child}
            </View>
          ))}
          {/* pad the final short row so cards keep their column width */}
          {row.length < cols
            ? Array.from({ length: cols - row.length }, (_, i) => <View key={`pad-${i}`} style={{ flex: 1 }} />)
            : null}
        </View>
      ))}
    </View>
  );
}
