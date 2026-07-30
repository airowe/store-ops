/**
 * Preview — try-before-signup. Heading + the shared <ListingAudit>. Signup is
 * gated at value (inside the audit result), never a cold login wall.
 */
import type { ApiClient } from "@shipaso/api";
import { ListingAudit } from "./ListingAudit.js";

export function PreviewView({ client, onSignIn }: { client: ApiClient; onSignIn: () => void }) {
  return (
    <section>
      {/* Kept in step with the mobile preview screen, which cannot say "free":
          it is captured into an App Store screenshot and Apple counts that as a
          price reference (Guideline 2.3.7). The web is not under App Review, but
          the two surfaces should read the same. */}
      <h1>Audit any listing — no signup</h1>
      <p className="muted">Audit any live App Store listing on real data. Sign in only when you want to run the fix.</p>
      <ListingAudit client={client} onSignIn={onSignIn} />
    </section>
  );
}
