/**
 * /competitors (#356) — the fleet-wide competitor index, from
 * `Competitors.dc.html`.
 *
 * Grouped by RIVAL, because one rival usually competes with several of your
 * apps and grouping by app would repeat it. But watching stays PER PAIR: a
 * rival confirmed on two of three apps is a real, common state, so each card
 * lists its app pairs with their own state and an unconfirmed pair carries its
 * own inline confirm. Only `confirmed` pairs ever feed a run.
 *
 * Honesty decisions carried by this file:
 *
 *  • NO shared-term count. The comp showed "9 terms shared"; that number is not
 *    measurable (rival ranks are never persisted, and the corpus keys on
 *    bundle_id while app_competitors keys on trackId), so it was deliberately
 *    left off `PortfolioRivalPair`. A pair chip is app-name + state, and the
 *    comp's trailing footnote — which existed only to qualify that count — is
 *    dropped with it.
 *  • The toolbar's app target is EXPLICIT and required. `addCompetitor` and
 *    `discoverCompetitors` are per app, so a portfolio-level action with no
 *    target would have to guess which app it acted for.
 *  • Card meta is COUNTED from the pairs received (see the model), never
 *    estimated and never carried over from the comp's sample data.
 *  • A suggestion's source is named from the pair's own `source` field.
 *  • The comp's rival-level "Stop watching" and "War room" are per-PAIR here:
 *    both act on one app, and a rival-level control would have to pick an app
 *    on the customer's behalf.
 *
 * The client is injected so the whole view is render-testable with a fake.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient, PortfolioRival, PortfolioRivalPair } from "@shipaso/api";
import {
  addCompetitor,
  confirmCompetitor,
  discoverCompetitors,
  getApps,
  getPortfolioCompetitors,
  removeCompetitor,
} from "@shipaso/api";
import {
  initial,
  isConfirmed,
  isWatched,
  rivalMeta,
  sourceLabel,
  suggestions,
  watchedSummary,
} from "./portfolioCompetitorsModel.js";

const RIVALS_KEY = ["portfolio", "competitors"];

type PairAction = (appId: string, rivalKey: string) => void;

export function PortfolioCompetitorsView({ client }: { client: ApiClient }) {
  const qc = useQueryClient();
  const rivalsQ = useQuery({ queryKey: RIVALS_KEY, queryFn: () => getPortfolioCompetitors(client) });
  const appsQ = useQuery({ queryKey: ["apps"], queryFn: () => getApps(client) });

  const apps = appsQ.data?.apps ?? [];
  const [targetOverride, setTargetOverride] = useState<string | null>(null);
  const target = targetOverride ?? apps[0]?.id ?? "";
  const [name, setName] = useState("");

  // Each write returns a per-app list, not the portfolio shape, so there is
  // nothing authoritative to write into this cache — refetch instead of
  // pretending the response reconciles it.
  const refetch = () => void qc.invalidateQueries({ queryKey: RIVALS_KEY });

  const add = useMutation({
    mutationFn: (n: string) => addCompetitor(client, target, { name: n }),
    onSuccess: () => {
      setName("");
      refetch();
    },
  });
  const discover = useMutation({
    mutationFn: () => discoverCompetitors(client, target),
    onSuccess: refetch,
  });
  const confirm = useMutation({
    mutationFn: (p: { appId: string; key: string }) => confirmCompetitor(client, p.appId, p.key),
    onSuccess: refetch,
  });
  const remove = useMutation({
    mutationFn: (p: { appId: string; key: string }) => removeCompetitor(client, p.appId, p.key),
    onSuccess: refetch,
  });

  const busy = add.isPending || discover.isPending || confirm.isPending || remove.isPending;
  const onConfirm: PairAction = (appId, key) => confirm.mutate({ appId, key });
  const onRemove: PairAction = (appId, key) => remove.mutate({ appId, key });

  return (
    <section className="pcomp" data-testid="portfolio-competitors">
      <h1 className="pcomp-title">Competitors</h1>
      <p className="pcomp-lede">
        Grouped by rival, because the same app usually competes with several of yours. Watching is
        still per app — a rival can feed one app’s runs and sit unconfirmed on another, and only{" "}
        <b>confirmed</b> pairs ever feed a run.
      </p>

      {rivalsQ.isLoading ? <LoadingState /> : null}

      {!rivalsQ.isLoading && rivalsQ.data ? (
        rivalsQ.data.rivals.length === 0 ? (
          <EmptyState />
        ) : (
          <Populated
            rivals={rivalsQ.data.rivals}
            apps={apps}
            target={target}
            onTarget={setTargetOverride}
            name={name}
            onName={setName}
            busy={busy}
            onAdd={() => add.mutate(name.trim())}
            onDiscover={() => discover.mutate()}
            onConfirm={onConfirm}
            onRemove={onRemove}
            discovering={discover.isPending}
          />
        )
      ) : null}
    </section>
  );
}

const SKELETONS = [0, 1, 2, 3];

function LoadingState() {
  return (
    <div data-testid="pcomp-loading">
      <div className="pcomp-skeletons">
        {SKELETONS.map((i) => (
          <div key={i} className="pcomp-skeleton" />
        ))}
      </div>
      <p className="pcomp-loading-note">Loading watched competitors…</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="pcomp-empty" data-testid="pcomp-empty">
      <div className="pcomp-eyebrow">Nobody watched</div>
      <div className="pcomp-empty-title">No competitors confirmed yet.</div>
      <p className="pcomp-empty-body">
        Discovery reads your tracked keywords and Apple’s similar-apps shelf to suggest rivals — so
        it needs at least one app with tracked keywords first. Nothing is watched until you confirm
        it.
      </p>
    </div>
  );
}

type AppOption = { id: string; name: string };

function Populated({
  rivals,
  apps,
  target,
  onTarget,
  name,
  onName,
  busy,
  onAdd,
  onDiscover,
  onConfirm,
  onRemove,
  discovering,
}: {
  rivals: PortfolioRival[];
  apps: AppOption[];
  target: string;
  onTarget: (id: string) => void;
  name: string;
  onName: (v: string) => void;
  busy: boolean;
  onAdd: () => void;
  onDiscover: () => void;
  onConfirm: PairAction;
  onRemove: PairAction;
  discovering: boolean;
}) {
  const watched = rivals.filter(isWatched);
  const suggested = suggestions(rivals);

  return (
    <>
      <div className="pcomp-toolbar" data-testid="pcomp-toolbar">
        <input
          className="pcomp-add-input"
          data-testid="pcomp-add-name"
          placeholder="Add a rival by app name"
          aria-label="Add a rival by app name"
          value={name}
          onChange={(e) => onName(e.target.value)}
        />
        <span className="pcomp-for">for</span>
        <select
          className="pcomp-target"
          data-testid="pcomp-target"
          aria-label="App to add or discover competitors for"
          value={target}
          onChange={(e) => onTarget(e.target.value)}
        >
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="pcomp-btn is-primary"
          data-testid="pcomp-add"
          disabled={busy || !name.trim() || !target}
          onClick={onAdd}
        >
          Add
        </button>
        <button
          type="button"
          className="pcomp-btn"
          data-testid="pcomp-discover"
          disabled={busy || !target}
          onClick={onDiscover}
        >
          {discovering ? "Discovering…" : "Discover"}
        </button>
      </div>

      {watched.length > 0 ? (
        <>
          <SectionHead
            label="Watched · feeding runs"
            live
            note={watchedSummary(watched)}
            noteTestId="pcomp-watched-summary"
          />
          <div className="pcomp-watched" data-testid="pcomp-watched">
            {watched.map((r) => (
              <RivalCard key={r.key} rival={r} busy={busy} onConfirm={onConfirm} onRemove={onRemove} />
            ))}
          </div>
        </>
      ) : null}

      {suggested.length > 0 ? (
        <>
          <SectionHead label="Suggested · not watched" note="confirm to start watching" />
          <div className="pcomp-suggested" data-testid="pcomp-suggested">
            {suggested.map(({ rival, pair }) => (
              <SuggestionCard
                key={`${rival.key}-${pair.app_id}`}
                rivalKey={rival.key}
                rivalName={rival.name}
                pair={pair}
                busy={busy}
                onConfirm={onConfirm}
                onRemove={onRemove}
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function SectionHead({
  label,
  note,
  live,
  noteTestId,
}: {
  label: string;
  note: string;
  live?: boolean;
  noteTestId?: string;
}) {
  return (
    <div className="pcomp-section-head">
      <div className={`pcomp-section-label${live ? " is-live" : ""}`}>
        <span className="pcomp-section-dot" aria-hidden="true" />
        {label}
      </div>
      <div className="pcomp-section-rule" aria-hidden="true" />
      <div className="pcomp-section-note" {...(noteTestId ? { "data-testid": noteTestId } : {})}>
        {note}
      </div>
    </div>
  );
}

function RivalCard({
  rival,
  busy,
  onConfirm,
  onRemove,
}: {
  rival: PortfolioRival;
  busy: boolean;
  onConfirm: PairAction;
  onRemove: PairAction;
}) {
  return (
    <div className="pcomp-card" data-testid={`pcomp-rival-${rival.key}`}>
      <div className="pcomp-card-head">
        <span className="pcomp-avatar" aria-hidden="true">
          {initial(rival.name)}
        </span>
        <span className="pcomp-card-ident">
          <span className="pcomp-card-name">{rival.name}</span>
          <span className="pcomp-card-meta" data-testid={`pcomp-meta-${rival.key}`}>
            {rivalMeta(rival)}
          </span>
        </span>
      </div>
      <div className="pcomp-pairs">
        {rival.pairs.map((p) => (
          <PairChip
            key={p.app_id}
            rivalKey={rival.key}
            pair={p}
            busy={busy}
            onConfirm={onConfirm}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One chip per (app, rival) pair, carrying the app name and the pair's own
 * state — and nothing else. There is no shared-term count to show, so the chip
 * does not reserve room for one.
 */
function PairChip({
  rivalKey,
  pair,
  busy,
  onConfirm,
  onRemove,
}: {
  rivalKey: string;
  pair: PortfolioRivalPair;
  busy: boolean;
  onConfirm: PairAction;
  onRemove: PairAction;
}) {
  const confirmed = isConfirmed(pair);
  return (
    <span
      className={`pcomp-pair${confirmed ? " is-confirmed" : ""}`}
      data-testid={`pcomp-pair-${rivalKey}-${pair.app_id}`}
      data-state={confirmed ? "confirmed" : "suggested"}
    >
      <span className="pcomp-pair-dot" aria-hidden="true" />
      <span className="pcomp-pair-app">{pair.app_name}</span>
      {confirmed ? (
        <button
          type="button"
          className="pcomp-pair-action"
          data-testid={`pcomp-stop-${rivalKey}-${pair.app_id}`}
          title={`Stop watching for ${pair.app_name}`}
          disabled={busy}
          onClick={() => onRemove(pair.app_id, rivalKey)}
        >
          stop
        </button>
      ) : (
        <button
          type="button"
          className="pcomp-pair-action is-confirm"
          data-testid={`pcomp-confirm-${rivalKey}-${pair.app_id}`}
          title={`Confirm for ${pair.app_name}`}
          disabled={busy}
          onClick={() => onConfirm(pair.app_id, rivalKey)}
        >
          confirm
        </button>
      )}
    </span>
  );
}

function SuggestionCard({
  rivalKey,
  rivalName,
  pair,
  busy,
  onConfirm,
  onRemove,
}: {
  rivalKey: string;
  rivalName: string;
  pair: PortfolioRivalPair;
  busy: boolean;
  onConfirm: PairAction;
  onRemove: PairAction;
}) {
  return (
    <div className="pcomp-suggestion" data-testid={`pcomp-suggestion-${rivalKey}-${pair.app_id}`}>
      <div className="pcomp-suggestion-ident">
        <div className="pcomp-suggestion-name">{rivalName}</div>
        <div
          className="pcomp-suggestion-meta"
          data-testid={`pcomp-suggestion-meta-${rivalKey}-${pair.app_id}`}
        >
          {`${sourceLabel(pair.source)} · ${pair.app_name}`}
        </div>
      </div>
      <div className="pcomp-suggestion-actions">
        <button
          type="button"
          className="pcomp-btn is-primary is-small"
          data-testid={`pcomp-suggestion-confirm-${rivalKey}-${pair.app_id}`}
          disabled={busy}
          onClick={() => onConfirm(pair.app_id, rivalKey)}
        >
          {`Confirm for ${pair.app_name}`}
        </button>
        <button
          type="button"
          className="pcomp-btn is-small"
          data-testid={`pcomp-suggestion-dismiss-${rivalKey}-${pair.app_id}`}
          disabled={busy}
          onClick={() => onRemove(pair.app_id, rivalKey)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
