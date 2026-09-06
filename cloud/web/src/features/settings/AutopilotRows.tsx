/**
 * The two switches that change what the agent DOES after you approve
 * (migration 0017), in the order the API enforces:
 *
 *   1. Write to App Store Connect — consent. Off means every store write is a
 *      command you run yourself, as it always was.
 *   2. Execute approved runs — with consent on, an approval is your last act;
 *      the agent finds or creates the editable version and pushes the
 *      approved copy and locales, and records every step on the run.
 *
 * Honesty, verbatim from the server: the second switch is refused until the
 * first is on; turning it on QUARANTINES runs approved before it existed
 * rather than pushing them on an old approval, and says how many. Nothing
 * here submits, releases, or touches a live version — the copy says so.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { setAscWrites, setAutopilot } from "@shipaso/api";

export function AutopilotRows({
  client,
  ascWrites,
  autopilot,
  onChange,
}: {
  client: ApiClient;
  ascWrites: boolean;
  autopilot: boolean;
  onChange: (next: { ascWrites?: boolean; autopilot?: boolean }) => void;
}) {
  const [quarantined, setQuarantined] = useState<number | null>(null);

  const writesMut = useMutation({
    mutationFn: (next: boolean) => setAscWrites(client, next),
    onSuccess: (r) => onChange({ ascWrites: r.asc_write_opt_in, ...(r.asc_write_opt_in ? {} : { autopilot: false }) }),
  });
  const autoMut = useMutation({
    mutationFn: (next: boolean) => setAutopilot(client, next),
    onSuccess: (r) => {
      onChange({ autopilot: r.autopilot_execute });
      setQuarantined(r.autopilot_execute ? r.quarantined : null);
    },
  });

  return (
    <div data-testid="autopilot-rows">
      <div className="pref-row">
        <div className="pref-row-main">
          <div className="pref-row-title">Write to App Store Connect</div>
          <div className="pref-row-detail">
            {ascWrites
              ? "On — after you approve, ShipASO may push metadata and screenshots to a draft version with your stored key. Never a live version, never a submission."
              : "Off — every store write is a command you run yourself. Approving only reveals it."}
          </div>
        </div>
        <button
          type="button"
          className={"btn" + (ascWrites ? " ghost" : "")}
          data-testid="asc-writes-toggle"
          disabled={writesMut.isPending}
          onClick={() => writesMut.mutate(!ascWrites)}
        >
          {writesMut.isPending ? "…" : ascWrites ? "On" : "Off"}
        </button>
      </div>

      <div className="pref-row">
        <div className="pref-row-main">
          <div className="pref-row-title">Execute approved runs</div>
          <div className="pref-row-detail">
            {!ascWrites
              ? "Needs the switch above. With it on, approving becomes your last step."
              : autopilot
                ? "On — approving is your last step. The agent finds or creates the draft version, pushes the copy and each approved locale, and records every step on the run. Screenshots and experiments still need you."
                : "Off — approving reveals the push commands; running them is yours."}
          </div>
          {quarantined !== null && quarantined > 0 ? (
            <div className="pref-row-detail" data-testid="autopilot-quarantined">
              {`${quarantined} run${quarantined === 1 ? " was" : "s were"} approved before this switch existed. They stay untouched; open one and choose Execute now to run it.`}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={"btn" + (autopilot ? " ghost" : "")}
          data-testid="autopilot-toggle"
          disabled={autoMut.isPending || !ascWrites}
          onClick={() => autoMut.mutate(!autopilot)}
        >
          {autoMut.isPending ? "…" : autopilot ? "On" : "Off"}
        </button>
      </div>
      {autoMut.isError ? (
        <p className="conn-note" data-testid="autopilot-error">
          {autoMut.error instanceof Error ? autoMut.error.message : "Could not change the switch."}
        </p>
      ) : null}
    </div>
  );
}
