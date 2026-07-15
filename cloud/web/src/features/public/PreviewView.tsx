/**
 * Preview — try-before-signup. Heading + the shared <ListingAudit>. Signup is
 * gated at value (inside the audit result), never a cold login wall.
 */
import type { ApiClient } from "@shipaso/api";
import { ListingAudit } from "./ListingAudit.js";

export function PreviewView({ client, onSignIn }: { client: ApiClient; onSignIn: () => void }) {
  return (
    <section>
      <h1>Try it — free, no signup</h1>
      <p className="muted">Audit any live App Store listing on real data. Sign in only when you want to run the fix.</p>
      <ListingAudit client={client} onSignIn={onSignIn} />
    </section>
  );
}
