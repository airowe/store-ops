/**
 * KeywordStanding — where an app sits across ALL its tracked keywords right now
 * (#473). The companion to RankChart (one keyword over time) and MultiLineChart
 * (portfolio trend): this answers "how am I doing overall", which a single
 * sweep genuinely measures and neither trend view can show.
 *
 * MultiLineChart needs ≥2 measured points per series, so an app whose keywords
 * are mostly unranked renders nothing there — while still having a real
 * standing. Heathen holds #1 for two terms and is absent for 24 others; that is
 * a strong position no trend chart surfaces.
 *
 * Honesty, load-bearing:
 *   • position on a common scale carries RANK and nothing else — the most
 *     accurate perceptual channel spent on the primary quantity,
 *   • an unranked keyword sits OFF the scale in its own column, never plotted
 *     at the 200 floor. Filling a gap with a default makes a real absence read
 *     as a bad position, and readers reliably stop noticing it,
 *   • every row carries the date it was measured, and a stale row says so
 *     rather than implying it is current,
 *   • the headline is "N of M ranked" — a figure that gets WORSE when a term
 *     drops out. A number that can only climb is decoration.
 */
import { formatRank } from "@shipaso/honesty";

/** One keyword's latest reading. `rank: null` = searched, not in the results. */
export type StandingEntry = {
  keyword: string;
  /** measured position, or null when the term was searched and not found. */
  rank: number | null;
  /** how many apps competed for the term (Rank.total). null when unknown. */
  total: number | null;
  /** ISO date the reading was taken. */
  checked_at: string;
};

/** How deep the rank scan goes — the scale's extent, and what "not in" means. */
export const SCAN_DEPTH = 200;

/** A reading older than this reads as stale rather than current. */
export const STALE_DAYS = 21;

/**
 * Pure: ranked first (best position leads), then the unranked ordered by how
 * contested they are. An unranked term on a busy keyword is a bigger miss than
 * one nobody searches, so the tail is sorted by competitor count descending.
 */
export function sortStanding(entries: readonly StandingEntry[]): StandingEntry[] {
  const ranked = entries.filter((e) => e.rank !== null);
  const absent = entries.filter((e) => e.rank === null);
  ranked.sort((a, b) => (a.rank as number) - (b.rank as number));
  absent.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  return [...ranked, ...absent];
}

/** Pure: is this reading old enough that presenting it as current would mislead? */
export function isStale(checkedAt: string, now: number): boolean {
  const t = Date.parse(checkedAt);
  if (Number.isNaN(t)) return false; // unparseable → don't invent staleness
  return (now - t) / 86_400_000 > STALE_DAYS;
}

/** Pure: the headline counts. Separated so the copy can't drift from the data. */
export function standingSummary(entries: readonly StandingEntry[]): {
  ranked: number;
  tracked: number;
  best: number | null;
  topFive: number;
} {
  const ranked = entries.filter((e) => e.rank !== null);
  const positions = ranked.map((e) => e.rank as number);
  return {
    ranked: ranked.length,
    tracked: entries.length,
    best: positions.length ? Math.min(...positions) : null,
    topFive: positions.filter((r) => r <= 5).length,
  };
}

export function KeywordStanding({
  entries,
  now = Date.now(),
  width = 900,
}: {
  entries: readonly StandingEntry[];
  now?: number;
  width?: number;
}) {
  const rows = sortStanding(entries);
  if (rows.length === 0) return null;

  const summary = standingSummary(rows);
  const ROW = 17;
  const L = 178;
  const T = 58;
  const GUTTER = 118;
  const rule = width - GUTTER - 46;
  const plotW = rule - L - 14;
  const height = T + rows.length * ROW + 26;
  const xFor = (rank: number) => L + ((rank - 1) / (SCAN_DEPTH - 1)) * plotW;

  return (
    <div className="kw-standing" data-testid="keyword-standing">
      <p className="kw-standing-headline" data-testid="standing-headline">
        <strong>
          {summary.ranked} of {summary.tracked}
        </strong>{" "}
        keywords ranked
        {summary.best !== null ? ` · best ${formatRank(summary.best)}` : ""}
      </p>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="kw-standing-plot"
        role="img"
        aria-label={`Keyword standing. ${summary.ranked} of ${summary.tracked} tracked keywords rank in the top ${SCAN_DEPTH}. ${summary.tracked - summary.ranked} were searched and did not appear.`}
      >
        {[1, 50, 100, 150, 200].map((r) => (
          <g key={r}>
            <line
              x1={xFor(r)}
              y1={T - 12}
              x2={xFor(r)}
              y2={T + rows.length * ROW - 4}
              stroke="var(--line-soft)"
              strokeWidth={1}
            />
            <text x={xFor(r)} y={T - 20} textAnchor="middle" className="kw-standing-tick">
              #{r}
            </text>
          </g>
        ))}

        {/* absent sits OFF the scale, behind a rule — never at the 200 floor */}
        <line
          x1={rule}
          y1={T - 28}
          x2={rule}
          y2={T + rows.length * ROW - 4}
          stroke="var(--line)"
          strokeWidth={1}
          strokeDasharray="3 4"
        />
        <text x={rule + 12} y={T - 34} className="kw-standing-axis">
          NOT RANKING
        </text>

        {rows.map((e, i) => {
          const y = T + i * ROW + 6;
          const held = e.rank !== null;
          const stale = isStale(e.checked_at, now);
          return (
            <g
              key={e.keyword}
              data-testid={`standing-row-${e.keyword}`}
              aria-label={`${e.keyword}. ${
                held ? `position ${e.rank} of ${SCAN_DEPTH}` : `searched, not in the top ${SCAN_DEPTH}`
              }. Measured ${e.checked_at}.${stale ? " Stale reading." : ""}`}
            >
              <text
                x={L - 14}
                y={y + 4}
                textAnchor="end"
                className="kw-standing-label"
                opacity={stale ? 0.55 : 1}
              >
                {e.keyword}
              </text>

              {held ? (
                <>
                  <line
                    x1={xFor(1)}
                    y1={y}
                    x2={xFor(e.rank as number)}
                    y2={y}
                    stroke="var(--signal)"
                    strokeWidth={1.6}
                    opacity={0.32}
                  />
                  <circle
                    cx={xFor(e.rank as number)}
                    cy={y}
                    r={4.4}
                    fill="var(--signal)"
                    opacity={stale ? 0.5 : 1}
                    data-testid={`dot-${e.keyword}`}
                  />
                  <text
                    x={xFor(e.rank as number) + 11}
                    y={y + 4}
                    className="kw-standing-value"
                    fill="var(--signal)"
                  >
                    {formatRank(e.rank)}
                  </text>
                </>
              ) : (
                <circle
                  cx={rule + 50}
                  cy={y}
                  r={4}
                  fill="none"
                  stroke="var(--faint)"
                  strokeWidth={1.4}
                  strokeDasharray="2.2 1.8"
                  data-testid={`absent-${e.keyword}`}
                />
              )}

              <text
                x={width - 16}
                y={y + 4}
                textAnchor="end"
                className="kw-standing-value kw-standing-total"
              >
                {e.total ?? "—"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
