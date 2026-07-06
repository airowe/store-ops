/**
 * Proof — aggregate, MEASURED rank wins across connected apps. Honest: real
 * numbers only (a genuine 0 shows as 0, never hidden or inflated). Nothing
 * simulated.
 */
import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { getProof } from "@shipaso/api";

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

export function ProofView({ client }: { client: ApiClient }) {
  const q = useQuery({ queryKey: ["proof"], queryFn: () => getProof(client) });
  if (q.isLoading) return <p className="muted">Loading proof…</p>;
  if (q.isError || !q.data) return <p className="muted">Couldn’t load proof.</p>;
  const p = q.data;
  return (
    <section>
      <h1>Proof</h1>
      <p className="muted">Real, measured rank wins across connected apps. Nothing simulated.</p>
      <div className="grid">
        <Stat label="apps with wins" value={p.appsWithWins} />
        <Stat label="total wins" value={p.totalWins} />
        <Stat label="best improvement" value={p.bestImprovement} suffix=" ranks" />
        <Stat label="median improvement" value={p.medianImprovement} suffix=" ranks" />
      </div>
    </section>
  );
}
