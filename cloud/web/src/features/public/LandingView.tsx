/**
 * Landing — the public marketing front door at "/". Renders for everyone (no
 * auth branching). Leads with a live inline audit (the value IS the hero), a
 * plain 3-step how-it-works, and REAL measured proof with a graceful empty
 * state — never a fabricated number. Honest voice throughout.
 */
import { useQuery } from "@tanstack/react-query";
import type { ApiClient, ProofAggregate } from "@shipaso/api";
import { getProof } from "@shipaso/api";
import { ListingAudit } from "./ListingAudit.js";

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

const STEPS: { title: string; body: string }[] = [
  { title: "Audit", body: "See your real keyword ranks on live data. No signup." },
  { title: "Approve", body: "You decide what changes. Nothing auto-ships." },
  { title: "Run", body: "The fix is pushed — your credentials stay on your machine." },
];

export function LandingView({
  client,
  onSignIn,
}: {
  client: ApiClient;
  onSignIn: () => void;
}) {
  const proofQ = useQuery<ProofAggregate>({ queryKey: ["proof"], queryFn: () => getProof(client), retry: false });
  const p = proofQ.data;
  const hasWins = !proofQ.isError && !!p && p.totalWins > 0;

  return (
    <section>
      <div data-testid="landing-hero">
        <h1>Know exactly where your app ranks — then fix it.</h1>
        <p className="muted" style={{ maxWidth: 560 }}>
          ShipASO audits your App Store listing on real keyword data, proposes the fix, and runs it —
          your credentials never leave your machine.
        </p>
        <ListingAudit client={client} onSignIn={onSignIn} />
        <p className="faint" style={{ marginTop: 10 }}>
          Already have apps connected?{" "}
          <button type="button" className="btn ghost" data-testid="landing-signin" onClick={onSignIn}>
            Sign in
          </button>
        </p>
      </div>

      <h2 style={{ marginTop: 36 }}>How it works</h2>
      <div className="grid" data-testid="how-it-works">
        {STEPS.map((s, i) => (
          <div className="card" key={s.title}>
            <b>
              {i + 1}. {s.title}
            </b>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              {s.body}
            </p>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 36 }}>Proof</h2>
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
        <button type="button" className="btn ghost" data-testid="landing-close-signin" onClick={onSignIn}>
          Sign in
        </button>
      </div>
    </section>
  );
}
