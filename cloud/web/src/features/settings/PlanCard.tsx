/**
 * Settings › Plan: the effective tier, how it was obtained, when it ends —
 * and the one self-serve grant that exists, the Shipaton Pass code.
 *
 * Measured-or-nothing applies to a plan like a rank: the tier and the end
 * date come from `/auth/me`; an account with no end date shows none rather
 * than a placeholder. The claim form posts the code and prints the server's
 * own reason on refusal (wrong code, window closed, plan already higher).
 * Nothing here charges anyone or opens a checkout.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient, ClaimPassResult, PlanTier } from "@shipaso/api";
import { claimPass } from "@shipaso/api";

const SHIPATON_STATUS = "comped:shipaton-2026";
const TIER_LABEL: Record<PlanTier, string> = { free: "Free", indie: "Indie", startup: "Startup", scale: "Scale" };

function day(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

function describePlan(tier: PlanTier, status: string | null | undefined, until: string | null | undefined): string {
  const end = day(until);
  if (status === SHIPATON_STATUS) return `Shipaton Pass${end ? ` until ${end}` : ""}.`;
  if (status?.startsWith("comped")) return `Comped${end ? ` until ${end}` : ""}.`;
  if (status?.startsWith("expired:")) return `The pass ended${end ? ` on ${end}` : ""}. Free until you subscribe.`;
  if (tier === "free") return "Run the agent yourself; the hosted loop needs a paid plan.";
  return end ? `Renews ${end}.` : "Active.";
}

export function PlanCard({
  client,
  tier,
  planStatus,
  planUntil,
  onClaimed,
}: {
  client: ApiClient;
  tier: PlanTier;
  planStatus: string | null | undefined;
  planUntil: string | null | undefined;
  onClaimed: (r: ClaimPassResult) => void;
}) {
  const [code, setCode] = useState("");
  const claimMut = useMutation({
    mutationFn: (c: string) => claimPass(client, c),
    onSuccess: (r) => {
      setCode("");
      onClaimed(r);
    },
  });
  const onPass = planStatus === SHIPATON_STATUS;
  const canClaim = tier === "free" || tier === "indie";

  return (
    <div data-testid="plan-card">
      <div className="pref-row">
        <div className="pref-row-main">
          <div className="pref-row-title" data-testid="plan-tier">
            {TIER_LABEL[tier]}
          </div>
          <div className="pref-row-detail" data-testid="plan-detail">
            {describePlan(tier, planStatus, planUntil)}
          </div>
        </div>
      </div>
      {canClaim && !onPass ? (
        <form
          className="pref-row"
          data-testid="plan-claim"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) claimMut.mutate(code);
          }}
        >
          <div className="pref-row-main">
            <div className="pref-row-title">Have a pass code?</div>
            <div className="pref-row-detail">
              Building a Shipaton app? The Shipaton Pass is Startup, free, through 2026-12-31. Type the
              code once. It never replaces a plan that already covers more.
            </div>
            {claimMut.isError ? (
              <div className="pref-row-detail is-error" data-testid="plan-claim-error">
                {(claimMut.error as Error).message}
              </div>
            ) : null}
          </div>
          <span className="claim-form">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code"
              aria-label="Pass code"
              autoComplete="off"
              spellCheck={false}
              data-testid="plan-code"
            />
            <button type="submit" className="btn" disabled={claimMut.isPending || !code.trim()} data-testid="plan-claim-submit">
              {claimMut.isPending ? "Claiming…" : "Claim"}
            </button>
          </span>
        </form>
      ) : null}
    </div>
  );
}
