/**
 * Landing — the public marketing front door at "/". The live audit IS the hero:
 * a two-column layout puts the pitch + audit field on the left and the real
 * result card on the right, so the value lands without a signup wall (Public
 * Audit.dc.html). Below the fold: measured proof with a graceful empty state —
 * never a fabricated number. Honest voice throughout.
 */
import { useQuery } from "@tanstack/react-query";
import type { ApiClient, ProofAggregate } from "@shipaso/api";
import { getProof } from "@shipaso/api";
import { AuditInput } from "./AuditInput.js";
import { AuditResultCard } from "./AuditResultCard.js";
import { useListingAudit } from "./useListingAudit.js";
import { LaunchSignup } from "./LaunchSignup.js";

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="card stat">
      <div className="stat-v" data-testid={`stat-${label}`}>
        {value}
        {suffix ?? ""}
      </div>
      <div className="stat-k">{label}</div>
    </div>
  );
}

const STEPS: { n: string; title: string; body: string }[] = [
  { n: "01", title: "Audit", body: "Real keyword ranks on live data. No signup." },
  { n: "02", title: "Approve", body: "You decide every change. Nothing auto-ships." },
  { n: "03", title: "Run", body: "Push from your machine, your credentials." },
];

export function LandingView({ client, onSignIn }: { client: ApiClient; onSignIn: () => void }) {
  const proofQ = useQuery<ProofAggregate>({ queryKey: ["proof"], queryFn: () => getProof(client), retry: false });
  const p = proofQ.data;
  const hasWins = !proofQ.isError && !!p && p.totalWins > 0;
  const audit = useListingAudit(client);

  return (
    <section className="landing">
      <div className="landing-hero" data-testid="landing-hero">
        {/* left — pitch + the audit itself */}
        <div className="hero-pitch">
          <div className="free-pill">
            <span className="free-dot" aria-hidden="true" />
            Free · no signup
          </div>
          <h1 className="hero-headline">
            Know exactly where
            <br />
            your app ranks.
            <br />
            <span className="hero-headline-accent">Then fix it.</span>
          </h1>
          <p className="hero-sub">
            Audit any App Store listing on real keyword data. See your ranks, get the fix — your
            credentials never leave your machine.
          </p>

          <AuditInput audit={audit} />

          <div className="steps-strip" data-testid="how-it-works">
            {STEPS.map((s) => (
              <div className="step-card" key={s.title}>
                <div className="step-n mono">{s.n}</div>
                <div className="step-title">{s.title}</div>
                <div className="step-body">{s.body}</div>
              </div>
            ))}
          </div>
        </div>

        {/* right — the live result */}
        <AuditResultCard result={audit.result} onSignIn={onSignIn} />
      </div>

      <h2 style={{ marginTop: 44 }}>Proof</h2>
      {hasWins ? (
        <div className="grid" data-testid="proof-stats">
          <Stat label="apps with wins" value={p.appsWithWins} />
          <Stat label="total wins" value={p.totalWins} />
          <Stat label="best improvement" value={p.bestImprovement} suffix=" ranks" />
          <Stat label="median improvement" value={p.medianImprovement} suffix=" ranks" />
        </div>
      ) : (
        <p className="muted" data-testid="proof-empty">
          Connect an app to start measuring real wins — every number here is measured, never simulated.
        </p>
      )}

      <div className="card" style={{ marginTop: 36 }}>
        <b>Your credentials, your machine — nothing simulated.</b>
        <p className="muted" style={{ margin: "6px 0 12px" }}>
          Audit any listing free. Sign in only when you want to run the fix.
        </p>
        <button type="button" className="btn ghost" data-testid="landing-signin" onClick={onSignIn}>
          Sign in
        </button>
      </div>

      <LaunchSignup client={client} />
    </section>
  );
}
