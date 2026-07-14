/**
 * Locale-native keyword ideas (#180 Phase 3) — previously curl-only. Pick a
 * target storefront and get the keyword terms real apps in that market actually
 * use, MEASURED from that country's App Store (never a translation of your
 * en-US set). Honest: each candidate shows how many market apps use it, and the
 * empty-state note (no tracked keywords yet) is shown verbatim, never faked.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient, LocaleKeywordsResult } from "@shipaso/api";
import { getLocaleKeywords } from "@shipaso/api";

export function LocaleKeywordsCard({ client, appId }: { client: ApiClient; appId: string }) {
  const [market, setMarket] = useState("");
  const run = useMutation<LocaleKeywordsResult, Error, string>({
    mutationFn: (m: string) => getLocaleKeywords(client, appId, { market: m }),
  });

  const data = run.data;
  const candidates = data?.candidates ?? [];

  return (
    <div className="card" data-testid="locale-keywords-card">
      <b>Locale-native keywords</b>
      <p className="micro">
        Terms real apps in a target market use — measured from that storefront, not translated from English.
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input
          data-testid="lk-market"
          placeholder="Storefront, e.g. jp, de, fr"
          value={market}
          onChange={(e) => setMarket(e.target.value)}
        />
        <button type="button"
          className="btn"
          data-testid="lk-run"
          disabled={run.isPending || !market.trim()}
          onClick={() => run.mutate(market.trim())}
        >
          {run.isPending ? "Searching…" : "Find keywords"}
        </button>
      </div>

      {run.isError ? (
        <p className="micro" data-testid="lk-error">{run.error.message}</p>
      ) : null}

      {data?.note ? <p className="micro" data-testid="lk-note">{data.note}</p> : null}

      {candidates.length > 0 ? (
        <div data-testid="lk-results" style={{ marginTop: 8 }}>
          <p className="micro">
            Top terms in <b>{data!.market.toUpperCase()}</b> (used by N market apps):
          </p>
          {candidates.map((c) => (
            <div key={c.term} className="setting-row" data-testid={`lk-term-${c.term}`}>
              <span style={{ flex: 1 }}>{c.term}</span>
              <span className="micro" title={c.usedBy.join(", ")}>
                {c.usedByCount} app{c.usedByCount === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      ) : run.isSuccess && !data?.note ? (
        <p className="faint" data-testid="lk-empty">
          No new market-native terms found — the top apps there share no terms you don’t already target.
        </p>
      ) : null}
    </div>
  );
}
