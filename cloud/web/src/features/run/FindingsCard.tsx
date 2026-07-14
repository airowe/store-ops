/**
 * Listing audit findings — the PRD 02 surfaces, ported from the legacy
 * dashboard's audit card (PRD 07 slice). Three honest lanes, never mixed:
 *   • actionable fixes (critical/warn/good/info, sorted by the engine),
 *   • status/context facts (`context: true`) in their own strip,
 *   • locked surfaces (🔒 capability gaps) collapsed into ONE connect CTA —
 *     a button, not a wall of per-surface sentences. We still say what's
 *     hidden (honest capability gap, never a deficiency), but once, compactly.
 * `onConnect`, when provided, makes the CTA a client-side nav (to /settings);
 * without it the CTA falls back to a plain link so the card stays standalone.
 * Pure presentational; data arrives from the run detail response.
 */
import type { Finding, FindingsSummary, SurfaceLock } from "@shipaso/api";

const SEVERITY_COLOR: Record<Finding["severity"], string> = {
  critical: "var(--danger, #c0392b)",
  warn: "var(--warn, #b7791f)",
  good: "var(--signal, #2f855a)",
  info: "var(--muted, #718096)",
};

function FindingRow({ f }: { f: Finding }) {
  return (
    <div className="finding-row" data-testid={`finding-${f.id}`} style={{ margin: "10px 0" }}>
      <p style={{ margin: 0 }}>
        <span
          className="sev-chip"
          style={{ color: SEVERITY_COLOR[f.severity], fontSize: 12, marginRight: 8 }}
        >
          {f.severity}
        </span>
        <b>{f.title}</b>
      </p>
      <p className="micro" style={{ margin: "2px 0 0" }}>{f.detail}</p>
      {f.fix ? <p className="micro" style={{ margin: "2px 0 0" }}>→ {f.fix}</p> : null}
      {f.evidence ? <p className="micro muted" style={{ margin: "2px 0 0" }}>{f.evidence}</p> : null}
    </div>
  );
}

export function FindingsCard({
  findings,
  locks = [],
  summary,
  onConnect,
}: {
  findings: Finding[];
  locks?: SurfaceLock[];
  summary?: FindingsSummary;
  onConnect?: () => void;
}) {
  const unlock = findings.find((f) => f.id === "asc_unlock");
  const rest = findings.filter((f) => f.id !== "asc_unlock");
  const actionable = rest.filter((f) => !f.context);
  const context = rest.filter((f) => f.context);
  // Locked surfaces + the asc_unlock finding are the SAME ask ("connect to see
  // more"), so they collapse into one CTA instead of a per-surface wall.
  const showUnlock = unlock !== undefined || locks.length > 0;

  if (findings.length === 0 && locks.length === 0) return null;

  return (
    <div className="card" data-testid="findings-card">
      <b>Listing audit</b>
      {summary ? <p className="micro">{summary.label}</p> : null}

      <div data-testid="findings-list">
        {actionable.length === 0 ? (
          <p className="micro muted">No fixes found on the surfaces we could read.</p>
        ) : (
          actionable.map((f) => <FindingRow key={f.id} f={f} />)
        )}
      </div>

      {context.length > 0 ? (
        <div data-testid="listing-status" style={{ marginTop: 10 }}>
          <p className="micro muted" style={{ margin: 0 }}>Listing status</p>
          {context.map((f) => (
            <p key={f.id} className="micro" style={{ margin: "2px 0 0" }}>
              {f.title}
            </p>
          ))}
        </div>
      ) : null}

      {showUnlock ? (
        <div className="asc-unlock" data-testid="asc-unlock" style={{ marginTop: 12 }}>
          <p className="micro muted" style={{ margin: "0 0 8px" }}>
            {unlock?.detail ??
              `Connect App Store Connect to read the ${locks.length} surface${
                locks.length === 1 ? "" : "s"
              } we can't see publicly — and improve them.`}
          </p>
          {onConnect ? (
            <button type="button" className="btn primary" data-testid="asc-unlock-cta" onClick={onConnect}>
              Unlock your full audit
            </button>
          ) : (
            <a className="btn primary" data-testid="asc-unlock-cta" href="/settings">
              Unlock your full audit
            </a>
          )}
        </div>
      ) : null}
    </div>
  );
}
