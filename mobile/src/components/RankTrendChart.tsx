/**
 * RankTrendChart — the native rank-trend chart, rendered with **react-native-graph**
 * (Margelo, Skia): a GPU-accelerated animated line with a **pan scrubber**. Fed by
 * the honest `toGraphPoints` transform (inverted axis so #1 is highest; unmeasured
 * points dropped, not fabricated). Draws nothing for <2 measured points.
 *
 * Scrubbing shows the exact rank + date under your finger; released, the readout
 * falls back to the latest point. Native deps (Skia + Reanimated + Gesture
 * Handler) mean this needs a dev-client / EAS build — it won't run in Expo Go.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { LineGraph, SelectionDot, type GraphPoint } from "react-native-graph";
import { palette } from "../theme/index.js";
import { toGraphPoints, type RankSeriesPoint } from "../lib/rankSeries.js";
import { AppText, Card } from "./primitives.js";

/** value = -rank (inverted for display) → back to the real rank number. */
const rankOf = (p: GraphPoint) => Math.round(-p.value);
const dayOf = (p: GraphPoint) => p.date.toISOString().slice(0, 10);

export function RankTrendChart({ points, height = 130 }: { points: readonly RankSeriesPoint[]; height?: number }) {
  const { points: gp, gaps, empty } = toGraphPoints(points);
  const [selected, setSelected] = useState<GraphPoint | null>(null);
  if (empty) return null;

  const readout = selected ?? gp[gp.length - 1]!;
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <AppText kind="lead">Rank trend</AppText>
        <AppText kind="mono" style={{ color: palette.signal }} testID="scrub-readout">
          #{rankOf(readout)} · {dayOf(readout)}
        </AppText>
      </View>
      <View style={{ height }} testID="rank-trend-chart">
        <LineGraph
          style={{ flex: 1 }}
          points={gp}
          animated
          color={palette.signal}
          gradientFillColors={[palette.signal + "40", palette.signal + "00"]}
          lineThickness={2.5}
          enablePanGesture
          panGestureDelay={0}
          SelectionDot={SelectionDot}
          selectionDotShadowColor={palette.signal}
          onPointSelected={setSelected}
          onGestureEnd={() => setSelected(null)}
        />
      </View>
      <AppText kind="micro">
        Drag to scrub. Lower is better; history starts when tracking started.
        {gaps > 0 ? ` ${gaps} unmeasured point${gaps > 1 ? "s" : ""} omitted.` : ""}
      </AppText>
    </Card>
  );
}
