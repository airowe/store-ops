/**
 * Gauge — a small donut for the audit "keyword coverage" tile (N of M tracked
 * terms in the top 10). Hand-built SVG (per the handoff: simple data-viz stays
 * hand-built), theme-aware via the --signal / --line-soft tokens. The fraction
 * and label come from the pure `coverage()` helper so the honest "of M measured"
 * math is tested on its own — an app with nothing measured reads 0/0 → "—".
 */

export type Coverage = {
  /** How many measured lead ranks sit in the top 10. */
  inTop10: number;
  /** How many keywords are currently measured (the honest denominator). */
  measured: number;
  /** inTop10 / measured, or 0 when nothing is measured. */
  fraction: number;
  /** "61%" — or "—" when nothing is measured (never a fabricated 0%). */
  label: string;
};

/** Pure: coverage from a set of current ranks (null = unmeasured, excluded). */
export function coverage(currentRanks: readonly (number | null)[]): Coverage {
  const measuredRanks = currentRanks.filter((r): r is number => typeof r === "number");
  const measured = measuredRanks.length;
  const inTop10 = measuredRanks.filter((r) => r <= 10).length;
  const fraction = measured === 0 ? 0 : inTop10 / measured;
  return { inTop10, measured, fraction, label: measured === 0 ? "—" : `${Math.round(fraction * 100)}%` };
}

export function Gauge({ fraction, label, size = 64 }: { fraction: number; label: string; size?: number }) {
  const sw = 7;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const dash = Math.max(0, Math.min(1, fraction)) * c;

  return (
    <svg
      className="gauge"
      data-testid="gauge"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--line-soft)" strokeWidth={sw} />
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke="var(--signal)"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={`${dash.toFixed(1)} ${c.toFixed(1)}`}
        transform={`rotate(-90 ${cx} ${cx})`}
      />
      <text
        x={cx}
        y={cx + 5}
        textAnchor="middle"
        fontFamily="var(--display)"
        fontSize={size > 56 ? 17 : 14}
        fontWeight={600}
        fill="var(--ink)"
      >
        {label}
      </text>
    </svg>
  );
}
