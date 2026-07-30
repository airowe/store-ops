/**
 * AuditInput — the hero's audit field + CTA, plus the candidate picker when a
 * query matches more than one app. Presentational over `useListingAudit`, so
 * the landing hero can place it in the left column while the result card
 * renders on the right.
 */
import type { ListingAuditState } from "./useListingAudit.js";

export function AuditInput({ audit }: { audit: ListingAuditState }) {
  const canSearch = audit.query.trim().length > 0 && !audit.isPending;
  return (
    <div className="audit-input-block">
      <div className="audit-input-row">
        <input
          className="audit-field"
          data-testid="preview-query"
          value={audit.query}
          placeholder="App name or bundle id"
          onChange={(e) => audit.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSearch) audit.search(audit.query.trim());
          }}
        />
        <button
          type="button"
          className="btn primary audit-cta"
          data-testid="preview-search"
          disabled={!canSearch}
          onClick={() => audit.search(audit.query.trim())}
        >
          {audit.isPending ? "Auditing…" : "Audit free →"}
        </button>
      </div>
      <div className="audit-microcopy">Try it on any live app — no account, no card.</div>

      {audit.note ? (
        <p className="faint" data-testid="preview-note" style={{ marginTop: 10 }}>
          {audit.note}
        </p>
      ) : null}

      {audit.candidates?.map((c) => (
        <button
          key={c.bundle_id}
          type="button"
          className="card appcard"
          data-testid={`pcand-${c.bundle_id}`}
          style={{ padding: "10px 12px", marginTop: 6 }}
          onClick={() => audit.pick(c.bundle_id)}
        >
          <div className="name">{c.name}</div>
          <div className="bundle">{c.bundle_id}</div>
        </button>
      ))}
    </div>
  );
}
