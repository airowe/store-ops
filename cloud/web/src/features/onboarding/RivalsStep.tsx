/**
 * Onboarding step 3 — rivals, over the real competitor endpoints.
 *
 * The chips were previously local state that Continue threw away. They now read
 * and write `app_competitors`, the same store the app-detail CompetitorsCard
 * uses, so a rival confirmed during setup actually feeds the user's runs.
 *
 * Honest by construction: suggestions come from `discover` (iTunes, against the
 * app's tracked keywords) and are never silently watched — only CONFIRMED rows
 * feed runs. A freshly connected app usually has no tracked keywords yet, so
 * discovery returns nothing and says why; we show that note verbatim rather than
 * inventing plausible rival names to fill the space.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient, CompetitorsResponse } from "@shipaso/api";
import {
  addCompetitor,
  confirmCompetitor,
  discoverCompetitors,
  removeCompetitor,
} from "@shipaso/api";

export function RivalsStep({ client, appId }: { client: ApiClient; appId: string }) {
  const qc = useQueryClient();
  const key = ["onboarding", "competitors", appId];
  const [name, setName] = useState("");

  // Discovery IS the read here: it returns the full list (existing rows plus
  // anything newly found), so a separate GET would only duplicate it.
  const listQ = useQuery({ queryKey: key, queryFn: () => discoverCompetitors(client, appId) });

  const onList = (r: CompetitorsResponse) => qc.setQueryData(key, r);
  const add = useMutation({
    mutationFn: (n: string) => addCompetitor(client, appId, { name: n }),
    onSuccess: (r) => { onList(r); setName(""); },
  });
  const confirm = useMutation({
    mutationFn: (k: string) => confirmCompetitor(client, appId, k),
    onSuccess: onList,
  });
  const remove = useMutation({
    mutationFn: (k: string) => removeCompetitor(client, appId, k),
    onSuccess: onList,
  });

  if (listQ.isLoading) return <p className="onb-help">Looking for rivals…</p>;

  const all = listQ.data?.competitors ?? [];
  const confirmed = all.filter((c) => c.status === "confirmed");
  const suggested = all.filter((c) => c.status !== "confirmed");
  const busy = add.isPending || confirm.isPending || remove.isPending;

  return (
    <div className="onb-chip-area">
      <div className="onb-chips" data-testid="onb-rivals">
        {confirmed.map((c) => (
          <span key={c.key} className="onb-chip confirmed" data-testid={`onb-rival-${c.key}`}>
            {c.name}
            <button
              type="button"
              className="onb-chip-x"
              aria-label={`Remove ${c.name}`}
              disabled={busy}
              onClick={() => remove.mutate(c.key)}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          className="txt"
          data-testid="onb-rival-input"
          value={name}
          placeholder="Add a rival by app name"
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          data-testid="onb-rival-add"
          disabled={!name.trim() || busy}
          onClick={() => add.mutate(name.trim())}
        >
          Add
        </button>
      </div>

      {suggested.length ? (
        <>
          <div className="onb-suggest-label mono">Suggested from your keywords</div>
          <div className="onb-chips">
            {suggested.map((c) => (
              <button
                key={c.key}
                type="button"
                className="onb-chip suggest"
                data-testid={`onb-suggest-${c.key}`}
                disabled={busy}
                onClick={() => confirm.mutate(c.key)}
              >
                + {c.name}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {!all.length ? (
        <p className="onb-help" data-testid="onb-rivals-empty">
          {listQ.data?.note ?? "No suggestions yet — add a rival by name."}
        </p>
      ) : null}
    </div>
  );
}
