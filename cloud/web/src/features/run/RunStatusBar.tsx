/**
 * RunStatusBar — the app at a glance, above the decision. Honesty is
 * load-bearing: measured values (name, screenshot grade, coverage) render as
 * real; everything the run does NOT measure this branch — live version string,
 * rating, category rank, downloads — renders as an explicit placeholder or a
 * connect-analytics CTA, NEVER a fabricated number. Phase 2 (a filed follow-up)
 * extends the audit read so version/rating/rank become measured. Pure
 * presentational.
 */
import { runStatusLabel } from "../../lib/status.js";

export type RunStatusBarProps = {
  appName: string;
  version?: string;
  grade?: string | null;
  coverageScore?: number | null;
  status: string;
  onConnectAnalytics?: () => void;
};

export function RunStatusBar({
  appName, version, grade, coverageScore, status, onConnectAnalytics,
}: RunStatusBarProps) {
  return (
    <div className="run-status-bar" data-testid="status-bar">
      <span className="sb-app">{appName}</span>
      <span className="sb-cell" data-testid="sb-version">v{version ?? "—"} live</span>
      {/* rating is not measured anywhere in RunDetail this branch — honest dash */}
      <span className="sb-cell faint" data-testid="sb-rating">★—</span>
      {/* category rank is not on the run's audit — do not conflate with keyword lead-rank */}
      <span className="sb-cell faint" data-testid="sb-rank">#—</span>
      <span className="sb-cell" data-testid="sb-grade">shots {grade ?? "—"}</span>
      <span className="sb-cell" data-testid="sb-coverage">
        coverage {coverageScore == null ? "—" : coverageScore}
      </span>
      {onConnectAnalytics ? (
        <button
          type="button"
          className="sb-cta"
          data-testid="sb-downloads"
          onClick={onConnectAnalytics}
        >
          ↓— connect analytics →
        </button>
      ) : (
        <a className="sb-cta" data-testid="sb-downloads" href="/settings">
          ↓— connect analytics →
        </a>
      )}
      <span className="sb-cell sb-status" data-testid="sb-status">{runStatusLabel(status)}</span>
    </div>
  );
}
