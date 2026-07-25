/**
 * RunStatusBar — the app at a glance, above the decision. Honesty is
 * load-bearing: measured values (name, live version, rating, category rank,
 * screenshot grade, coverage) render as real, and anything the run did NOT
 * measure renders as an explicit placeholder, NEVER a fabricated number.
 *
 * Every stat here is measured-or-null (#326): the audit carries `null` where a
 * read happened but yielded nothing (e.g. the app is not in its category chart)
 * and omits the field entirely when no read happened. Both collapse to the same
 * honest dash — the bar never distinguishes them into an invented number.
 *
 * Downloads stays a connect-analytics CTA: it is only knowable through the
 * Analytics pipeline, so the bar asks for a connection instead of guessing.
 * Pure presentational.
 */
import { runStatusLabel } from "../../lib/status.js";

export type RunStatusBarProps = {
  appName: string;
  version?: string;
  /** measured star rating; either half is null when that half was unread.
   *  `source` names the surface it was read from — shown on hover only. */
  rating?: { average: number | null; count: number | null; source: "lookup" | "storefront" };
  /** measured category chart position; rank null = read, but not charting.
   *  `category` absent = we know the rank but not the category's name. */
  categoryRank?: { rank: number | null; category?: string };
  grade?: string | null;
  coverageScore?: number | null;
  status: string;
  onConnectAnalytics?: () => void;
};

export function RunStatusBar({
  appName, version, rating, categoryRank, grade, coverageScore, status, onConnectAnalytics,
}: RunStatusBarProps) {
  const average = rating?.average;
  const count = rating?.count;
  // The two surfaces can disagree, so the bar stays able to say WHICH one it
  // read — on hover, in customer language. The visible text is identical either
  // way: naming the source is provenance, not a caveat about the number.
  const ratingTitle = rating
    ? rating.source === "storefront"
      ? "Rating read from the App Store listing page"
      : "Rating read from the App Store lookup API"
    : undefined;
  return (
    <div className="run-status-bar" data-testid="status-bar">
      <span className="sb-app">{appName}</span>
      <span className="sb-cell" data-testid="sb-version">v{version ?? "—"} live</span>
      <span
        className={average == null ? "sb-cell faint" : "sb-cell"}
        data-testid="sb-rating"
        {...(ratingTitle !== undefined ? { title: ratingTitle } : {})}
      >
        {/* an unread average falls back to the honest dash; a read average with
            an unread count renders alone rather than inventing a count. */}
        ★{average == null ? "—" : average.toFixed(1)}
        {average != null && count != null ? ` (${count.toLocaleString("en-US")})` : ""}
      </span>
      <span
        className={categoryRank?.rank == null ? "sb-cell faint" : "sb-cell"}
        data-testid="sb-rank"
      >
        {/* category chart rank — NOT the keyword lead-rank; do not conflate. A
            read-but-not-charting app is null and shows the same honest dash. */}
        #{categoryRank?.rank == null ? "—" : categoryRank.rank}
        {/* the category clause needs a NAME; an unnamed genre renders a bare
            "#42" rather than the bug-looking "#42 in 6013". */}
        {categoryRank?.rank != null && categoryRank.category
          ? ` in ${categoryRank.category}`
          : ""}
      </span>
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
