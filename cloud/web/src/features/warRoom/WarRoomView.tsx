/**
 * War room — the standalone competitor rank route. Reconciles the divergence:
 * on the web it used to be an embedded card in the run view; here (matching
 * mobile) it's its own route. Competitor chips toggle which rivals are shown and
 * refetch; an honest "as of" line states when the ranks were checked.
 *
 * `override` is null until the user toggles (so the initial fetch fires once);
 * `available` is the first-seen full competitor set, kept stable so a toggled-off
 * rival's chip stays visible (and re-addable) even though the grid drops it.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { warRoom } from "@shipaso/api";
import { WarRoomGrid } from "./WarRoomGrid.js";

export function WarRoomView({ client, id }: { client: ApiClient; id: string }) {
  const [override, setOverride] = useState<string[] | null>(null);
  const [available, setAvailable] = useState<string[]>([]);

  const q = useQuery({
    queryKey: ["warroom", id, (override ?? []).slice().sort().join(",")],
    queryFn: () => warRoom(client, id, override ?? undefined),
  });

  useEffect(() => {
    if (q.data && available.length === 0) setAvailable(q.data.competitors);
  }, [q.data, available.length]);

  function toggle(c: string) {
    setOverride((prev) => {
      const cur = new Set(prev ?? available);
      if (cur.has(c)) cur.delete(c);
      else cur.add(c);
      return [...cur];
    });
  }

  const on = (c: string) => (override === null ? true : override.includes(c));

  return (
    <section>
      <h1>{q.data?.appName ?? "War room"}</h1>

      {available.length > 0 ? (
        <div className="war-selector">
          <span className="micro">Competitors:</span>
          {available.map((c) => (
            <button
              key={c}
              type="button"
              className={"war-chip" + (on(c) ? " on" : "")}
              data-testid={`chip-${c}`}
              onClick={() => toggle(c)}
            >
              {c}
            </button>
          ))}
        </div>
      ) : null}

      {q.isError ? (
        <p className="muted">Couldn’t load the war room.</p>
      ) : (
        <WarRoomGrid rows={q.data?.warRoom ?? []} competitors={q.data?.competitors ?? []} />
      )}

      {q.data?.checkedAt ? (
        <p className="micro war-asof" data-testid="as-of">
          As of {q.data.checkedAt.slice(0, 10)} · {q.data.window}-day window. Live-checked ranks; correlation, not causation.
        </p>
      ) : null}
    </section>
  );
}
