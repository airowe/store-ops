/**
 * Listing audit findings — the PRD 02 surfaces, ported from the legacy
 * dashboard's audit card (PRD 07 slice). Three honest lanes, never mixed:
 *   • actionable fixes (critical/warn/good/info, sorted by the engine),
 *   • status/context facts (`context: true`) in their own strip,
 *   • locked surfaces (🔒 capability gaps — "we can't see this", never a
 *     deficiency) + the asc_unlock CTA rendered exactly once.
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
}: {
  findings: Finding[];
  locks?: SurfaceLock[];
  summary?: FindingsSummary;
}) {
  const unlock = findings.find((f) => f.id === "asc_unlock");
  const rest = findings.filter((f) => f.id !== "asc_unlock");
  const actionable = rest.filter((f) => !f.context);
  const context = rest.filter((f) => f.context);

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

      {locks.length > 0 ? (
        <div data-testid="locks" style={{ marginTop: 10 }}>
          {locks.map((l) => (
            <p key={l.surface} className="micro" style={{ margin: "4px 0 0" }}>
              🔒 {l.label} — {l.unlockCopy}
            </p>
          ))}
        </div>
      ) : null}

      {unlock ? (
        <div data-testid="asc-unlock" style={{ marginTop: 10 }}>
          <b>{unlock.title}</b>
          <p className="micro" style={{ margin: "2px 0 0" }}>{unlock.detail}</p>
        </div>
      ) : null}
    </div>
  );
}
