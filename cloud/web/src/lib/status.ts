/**
 * Run-status display labels — ported from the legacy `labelFor()` in app.js.
 * Honesty: approval only REVEALS the push commands; nothing has shipped. So
 * `approved` AND legacy `shipped` both read "Approved · ready to push" — a
 * truthful "Shipped" is reserved for a confirmed push.
 */
const LABELS: Record<string, string> = {
  detected: "Detected",
  researching: "Researching",
  awaiting_approval: "Awaiting approval",
  approved: "Approved · ready to push",
  rejected: "Rejected",
  shipped: "Approved · ready to push",
  // an older run replaced by a newer one for the same app — a dead iteration,
  // not a phantom pending. Reads as resolved so nobody tries to act on it.
  superseded: "Superseded by a newer run",
};

export function runStatusLabel(status: string): string {
  return LABELS[status] ?? status;
}
