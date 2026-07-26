/**
 * /keywords (#356) — the fleet-wide keyword index, built from `Keywords.dc.html`.
 *
 * The honesty decisions this screen carries:
 *
 *  • A ROW IS A KEYWORD × APP × STOREFRONT PAIR. A rank belongs to one app in
 *    one storefront, so a keyword-only row would have to pick an app or average
 *    across them — both fabricate. Terms several apps chase are grouped: the
 *    lead row carries the term, continuations carry "↳".
 *  • UNMEASURED RANKS RENDER "—", NEVER 0, and live in their own explicit
 *    section that states the reason. Folding them into the table would rank them
 *    implicitly, and a 0 would read as "position zero".
 *  • THE HEADER TILES ARE COUNTED FROM THE ENTRIES WE RECEIVED. No counts
 *    endpoint exists and no number here is a literal.
 *  • NO PER-ROW SPARKLINE. `getRanks` returns an app-level series, not a
 *    per-keyword one, so a row sparkline would draw the app's trend against a
 *    keyword's name. A row's history opens on the app it belongs to instead.
 *  • The delta cell follows the same vocabulary as `RankMovementRow` (▲ / ▼ /
 *    "new" / "—"), driven by `direction` from the API rather than re-derived.
 *  • The default filter is "All", not the comp's "Moved": "Moved" hides every
 *    unmeasured row, which would make the explicit "Not measured this week"
 *    section invisible until the reader changed a filter they didn't set.
 *
 * The client is injected so the whole view is render-testable with a fake.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiClient, PortfolioDeltaEntry } from "@shipaso/api";
import { getPortfolioKeywords } from "@shipaso/api";
import {
  buildFilters,
  buildTiles,
  groupByTerm,
  matchesFilter,
  matchesTerm,
  partitionMeasured,
  TOP_RANK,
  type KeywordFilterId,
  type KeywordRow,
} from "./portfolioKeywordsModel.js";

const SKELETON_ROWS = 8;

const appHref = (entry: PortfolioDeltaEntry) => `/apps/${encodeURIComponent(entry.app_id)}`;

/**
 * The house rank-movement vocabulary, shared with `RankMovementRow`. It reads
 * `direction` straight from the API: "new" is a first snapshot and must never
 * become a count-up from nothing, and anything unmeasured or flat is "—".
 */
function DeltaCell({ entry }: { entry: PortfolioDeltaEntry }) {
  if (entry.direction === "up" || entry.direction === "down") {
    const cls = entry.direction === "up" ? "pkw-delta-up" : "pkw-delta-down";
    return (
      <span className={`pkw-delta ${cls}`} data-testid="pkw-delta">
        {entry.direction === "up" ? "▲" : "▼"}
        {Math.abs(entry.delta ?? 0)}
      </span>
    );
  }
  if (entry.direction === "new") {
    return (
      <span className="pkw-delta pkw-delta-new" data-testid="pkw-delta">
        new
      </span>
    );
  }
  // Measured, and gone (#360) — not a neutral "—", and carrying no number
  // because we do not know where it landed.
  if (entry.direction === "lost") {
    return (
      <span className="pkw-delta pkw-delta-lost" data-testid="pkw-delta" title="Was ranked; no longer in the results">
        lost
      </span>
    );
  }
  return (
    <span className="pkw-delta pkw-delta-flat" data-testid="pkw-delta">
      —
    </span>
  );
}

function KeywordTableRow({ row, measured }: { row: KeywordRow; measured: boolean }) {
  const { entry, isLead } = row;
  const top = measured && entry.current != null && entry.current <= TOP_RANK;
  return (
    <a
      className={`pkw-row${measured ? "" : " pkw-row-unmeasured"}${isLead ? "" : " pkw-row-cont"}`}
      href={appHref(entry)}
      data-testid={`pkw-row-${entry.keyword}-${entry.app_id}-${entry.country}`}
    >
      <span className="pkw-term-cell">
        <span className="pkw-prefix">{isLead ? "" : "↳"}</span>
        <span className="pkw-term" data-testid="pkw-term">
          {isLead ? entry.keyword : ""}
        </span>
      </span>
      <span className="pkw-app">{entry.app_name}</span>
      <span className={`pkw-rank${top ? " pkw-rank-top" : ""}`} data-testid="pkw-rank">
        {measured && entry.current != null ? `#${entry.current}` : "—"}
      </span>
      {/* DeltaCell handles every direction including "lost", so an unranked row
          is not forced to "—" — that would re-flatten the #360 distinction. */}
      <DeltaCell entry={entry} />
      <span className="pkw-store">{entry.country.toUpperCase()}</span>
      <span className="pkw-chev">›</span>
    </a>
  );
}

function LoadingState() {
  return (
    <div data-testid="pkw-loading">
      <div className="pkw-skeletons">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div className="pkw-skeleton" key={i} />
        ))}
      </div>
      <p className="pkw-loading-note">Reading this week's ranks…</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="pkw-empty" data-testid="pkw-empty">
      <div className="pkw-empty-eyebrow">Nothing tracked</div>
      <div className="pkw-empty-title">No keywords are being tracked yet.</div>
      <p className="pkw-empty-body">
        Tracking starts on an app's first run — the run reads the keyword field on your live listing
        and follows those terms from then on. There is no rank history before that point, and we
        won't invent one.
      </p>
      <a className="pkw-empty-cta" href="/">
        Run an audit to start tracking
      </a>
    </div>
  );
}

export function PortfolioKeywordsView({ client }: { client: ApiClient }) {
  const keywordsQ = useQuery({
    queryKey: ["portfolio", "keywords"],
    queryFn: () => getPortfolioKeywords(client),
  });

  const [filter, setFilter] = useState<KeywordFilterId>("all");
  const [query, setQuery] = useState("");

  const entries = keywordsQ.data?.entries;
  const filters = useMemo(() => buildFilters(entries ?? []), [entries]);
  const tiles = useMemo(() => buildTiles(entries ?? []), [entries]);

  const { measuredRows, lostRows, unmeasuredRows } = useMemo(() => {
    const visible = (entries ?? []).filter((e) => matchesFilter(e, filter) && matchesTerm(e, query));
    const { measured, lost, unmeasured } = partitionMeasured(visible);
    return {
      measuredRows: groupByTerm(measured),
      lostRows: groupByTerm(lost),
      unmeasuredRows: groupByTerm(unmeasured),
    };
  }, [entries, filter, query]);

  const isEmpty = entries != null && entries.length === 0;

  return (
    <div className="pkw-page" data-testid="portfolio-keywords">
      <h1 className="pkw-title">Keywords</h1>
      <p className="pkw-lede">
        Every term you track, across every app. A rank belongs to one app in one storefront, so a row
        here is a term <b>on one app</b> — terms several of your apps chase are bracketed together.
      </p>

      {keywordsQ.isPending ? <LoadingState /> : null}

      {isEmpty ? <EmptyState /> : null}

      {entries != null && entries.length > 0 ? (
        <>
          <div className="pkw-tiles" data-testid="pkw-tiles">
            {tiles.map((t) => (
              <div className="pkw-tile" key={t.id} data-testid={`pkw-tile-${t.id}`}>
                <div className="pkw-tile-label">{t.label}</div>
                <div className={`pkw-tile-value${t.id === "top" ? " pkw-tile-value-signal" : ""}`}>
                  {t.value}
                </div>
                <div className="pkw-tile-sub">{t.sub}</div>
              </div>
            ))}
          </div>

          <div className="pkw-controls">
            <input
              className="pkw-filter-input"
              placeholder="Filter terms…"
              aria-label="Filter terms"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="pkw-filter-input"
            />
            <div className="pkw-chips">
              {filters.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  className={`pkw-chip${filter === f.id ? " pkw-chip-on" : ""}`}
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  data-testid={`pkw-chip-${f.id}`}
                >
                  {f.label} · {f.count}
                </button>
              ))}
            </div>
            {/* The comp's sort menu is not wired, so the ordering is stated as a
                fact rather than rendered as a control that does nothing. */}
            <span className="pkw-sort-note">Sorted by biggest move</span>
          </div>

          <div className="pkw-table" data-testid="pkw-table">
            <div className="pkw-head">
              <span>Term</span>
              <span>App</span>
              <span className="pkw-num">Rank</span>
              <span className="pkw-num">7d</span>
              <span className="pkw-num">Store</span>
              <span />
            </div>

            {measuredRows.map((row) => (
              <KeywordTableRow key={row.id} row={row} measured />
            ))}

            {/* Fell out (#360): measured, and gone. Distinct from "not checked",
                and the more urgent of the two — so it leads. */}
            {lostRows.length > 0 ? (
              <>
                <div className="pkw-unmeasured-head" data-testid="pkw-lost-header">
                  <span className="pkw-lost-label">
                    Fell out of the results · {lostRows.length}
                  </span>
                  <span className="pkw-rule" />
                  <span className="pkw-unmeasured-why">
                    Ranked last time we checked; no longer in the top 200.
                  </span>
                </div>
                {lostRows.map((row) => (
                  <KeywordTableRow key={row.id} row={row} measured={false} />
                ))}
              </>
            ) : null}

            {unmeasuredRows.length > 0 ? (
              <>
                <div className="pkw-unmeasured-head" data-testid="pkw-unmeasured-header">
                  <span className="pkw-unmeasured-label">
                    Not checked this week · {unmeasuredRows.length}
                  </span>
                  <span className="pkw-rule" />
                  <span className="pkw-unmeasured-why">
                    The check hasn't run for these yet.
                  </span>
                </div>
                {unmeasuredRows.map((row) => (
                  <KeywordTableRow key={row.id} row={row} measured={false} />
                ))}
              </>
            ) : null}

            <div className="pkw-footnote" data-testid="pkw-footnote">
              Ranks are read once per week, per app, per storefront. A row's history opens on the app
              it belongs to.
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
