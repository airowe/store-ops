/**
 * The run page's answer, before its evidence.
 *
 * Measured before this existed: 8 equal-weight cards, 578 words, 2.6 screens —
 * with the verdict ("nothing needs your approval") appearing nowhere. The reader
 * had to derive it by reading everything and noticing the absence of fixes.
 *
 * The unlock CTA lives here rather than buried in the audit card, and it names
 * the app. "Unlock your full audit" read as a paywall; the truth is narrower and
 * more useful — credentials are per-app, and this one has no key.
 */
import type { FindingsSummary } from "@shipaso/api";
import { runVerdict } from "./runVerdict.js";

export function RunVerdictHeader({
  summary,
  lockCount,
  appName,
  onConnect,
}: {
  summary: FindingsSummary | undefined;
  lockCount: number;
  appName: string;
  onConnect?: (() => void) | undefined;
}) {
  // No summary ⇒ nothing measured ⇒ no verdict to give. Rendering an all-clear
  // here would assert something about a run we never read.
  if (!summary) return null;

  const v = runVerdict({ summary, lockCount });

  return (
    <header className="run-verdict" data-testid="run-verdict" data-tone={v.tone}>
      <h1 className="run-verdict-headline">{v.headline}</h1>
      {v.detail ? (
        <p className="run-verdict-detail" data-testid="run-verdict-detail">
          {v.detail}
        </p>
      ) : null}
      {lockCount > 0 && onConnect ? (
        <button
          type="button"
          className="btn primary run-verdict-cta"
          data-testid="run-verdict-connect"
          onClick={onConnect}
        >
          Connect a key for {appName}
        </button>
      ) : null}
    </header>
  );
}
