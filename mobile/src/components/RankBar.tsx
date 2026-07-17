/**
 * RankBar — a horizontal rank-strength bar. Length = rankFill(rank). A null
 * (unmeasured) rank renders NOTHING — the caller shows an explicit "—", never a
 * zero-length bar implying a bad rank (honesty invariant).
 */
import React from "react";
import { View } from "react-native";
import { palette } from "../theme/index.js";
import { rankFill } from "../lib/rankBar.js";

export function RankBar({ rank }: { rank: number | null }) {
  if (rank == null) return null;
  const pct = `${Math.round(rankFill(rank) * 100)}%` as const;
  return (
    <View
      testID="rank-bar"
      style={{ height: 7, borderRadius: 4, backgroundColor: palette.line, overflow: "hidden" }}
    >
      <View style={{ height: "100%", width: pct, borderRadius: 4, backgroundColor: palette.signal }} />
    </View>
  );
}
