/**
 * RankTrendChart — the native rank-trend chart, rendered with **react-native-graph**
 * (Margelo, Skia): a GPU-accelerated animated line. Fed by the honest
 * `toGraphPoints` transform (inverted axis so #1 is highest; unmeasured points
 * dropped, not fabricated). Draws nothing for <2 measured points.
 *
 * Native deps (Skia + Reanimated + Gesture Handler) mean this needs a dev-client
 * / EAS build — it won't run in Expo Go.
 */
import React from "react";
import { View } from "react-native";
import { LineGraph } from "react-native-graph";
import { palette } from "../theme/index.js";
import { toGraphPoints, type RankSeriesPoint } from "../lib/rankSeries.js";
import { AppText, Card } from "./primitives.js";

export function RankTrendChart({ points, height = 130 }: { points: readonly RankSeriesPoint[]; height?: number }) {
  const { points: gp, gaps, empty } = toGraphPoints(points);
  if (empty) return null;
  return (
    <Card>
      <AppText kind="lead">Rank trend</AppText>
      <View style={{ height }} testID="rank-trend-chart">
        <LineGraph
          style={{ flex: 1 }}
          points={gp}
          animated
          color={palette.signal}
          gradientFillColors={[palette.signal + "40", palette.signal + "00"]}
          lineThickness={2.5}
        />
      </View>
      <AppText kind="micro">
        Organic rank over time (lower is better). History starts when tracking started.
        {gaps > 0 ? ` ${gaps} unmeasured point${gaps > 1 ? "s" : ""} omitted.` : ""}
      </AppText>
    </Card>
  );
}
