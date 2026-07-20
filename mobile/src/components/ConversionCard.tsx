/**
 * ConversionCard (analytics-reports Phase 3) — the measured number that replaces
 * "—". Honesty, load-bearing:
 *   • the figure is Apple's MEASURED downloads ÷ product-page-views; when the
 *     latest day isn't measurable it reads "—" (unmeasured), never a fabricated 0;
 *   • movement around your approved pushes is CORRELATIONAL — the caveat is shown;
 *   • before anything is ingested there's no card at all (no zero series).
 * Pure — takes the surface the route returns; renders only.
 */
import { View } from "react-native";
import type { EngagementSurface } from "../types/api.js";
import { palette, spacing } from "../theme/index.js";
import { AppText, Card } from "./primitives.js";

const pct = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

export function ConversionCard({ data }: { data: EngagementSurface | undefined }) {
  // No card until there's measured data — never an empty/zero conversion.
  if (!data || data.state !== "measured") return null;
  const { latestConversion, movements } = data;
  const aggregate = movements.filter((m) => m.source === "");

  return (
    <Card>
      <AppText kind="lead">Measured conversion</AppText>
      <AppText kind="display" testID="conv-latest">
        {latestConversion ? (
          `${pct(latestConversion.rate)} `
        ) : (
          "— "
        )}
        <AppText kind="micro">
          {latestConversion ? `as of ${latestConversion.date}` : "unmeasured"}
        </AppText>
      </AppText>
      <AppText kind="micro">Downloads ÷ product-page views, from Apple’s Analytics Reports.</AppText>

      {aggregate.length > 0 ? (
        <View testID="conv-movements" style={{ marginTop: spacing.sm, gap: spacing.xs }}>
          {aggregate.map((m, i) => {
            const up = m.delta >= 0;
            return (
              <View
                key={`${m.at}-${i}`}
                testID="conv-move"
                style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
              >
                <AppText kind="body" style={{ color: up ? palette.signal : palette.bad }}>
                  {up ? "▲" : "▼"}
                </AppText>
                <View style={{ flex: 1 }}>
                  <AppText kind="body">
                    conversion {pct(m.before)} → {pct(m.after)}
                  </AppText>
                  <AppText kind="micro">
                    around {m.at} · {m.samplesBefore}/{m.samplesAfter}d
                  </AppText>
                </View>
              </View>
            );
          })}
          <AppText kind="micro">Around your approved pushes. Correlation, not causation.</AppText>
        </View>
      ) : null}
    </Card>
  );
}
