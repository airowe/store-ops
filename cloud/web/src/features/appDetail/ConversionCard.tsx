/**
 * Measured conversion (analytics-reports Phase 3) — the number that replaces "—".
 * Honesty, load-bearing:
 *   • the figure is Apple's MEASURED downloads ÷ product-page-views; when the
 *     latest day isn't measurable it reads "—" (unmeasured), never a fabricated 0,
 *   • movement around your approved pushes is CORRELATIONAL — the caveat is shown,
 *   • before anything is ingested there's no card at all (no zero series).
 * Pure — takes the surface the route returns; renders only.
 */
import type { EngagementSurface } from "@shipaso/api";

const pct = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

export function ConversionCard({ data }: { data: EngagementSurface | undefined }) {
  // No card until there's measured data — never an empty/zero conversion.
  if (!data || data.state !== "measured") return null;
  const { latestConversion, movements } = data;
  const aggregate = movements.filter((m) => m.source === "");

  return (
    <div className="card" data-testid="conversion">
      <b>Measured conversion</b>
      <p className="stat" data-testid="conv-latest">
        {latestConversion ? (
          <>
            {pct(latestConversion.rate)}
            <span className="micro"> as of {latestConversion.date}</span>
          </>
        ) : (
          <>
            —<span className="micro"> unmeasured</span>
          </>
        )}
      </p>
      <p className="micro">Downloads ÷ product-page views, from Apple’s Analytics Reports.</p>

      {aggregate.length > 0 ? (
        <div data-testid="conv-movements">
          {aggregate.map((m, i) => {
            const up = m.delta >= 0;
            return (
              <div key={`${m.at}-${i}`} className="anno-row" data-testid="conv-move">
                <span style={{ color: up ? "var(--signal)" : "var(--bad)" }}>{up ? "▲" : "▼"}</span>
                <span>
                  conversion {pct(m.before)} → {pct(m.after)}
                </span>
                <span className="micro">
                  around {m.at} · {m.samplesBefore}/{m.samplesAfter}d
                </span>
              </div>
            );
          })}
          <p className="micro">Around your approved pushes. Correlation, not causation.</p>
        </div>
      ) : null}
    </div>
  );
}
