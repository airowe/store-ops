/**
 * Run detail — THE money screen. The proposed-copy diff is always visible; the
 * approval gate is the one irreversible human step. Honesty, load-bearing:
 *   • approval only REVEALS the push paths — nothing has shipped. The status
 *     reads "Approved · ready to push", NEVER "Shipped" (legacy `shipped` too).
 *   • the one-click ASC push (#179) is an EXPLICIT second click, only offered
 *     when the user opted in to a stored key; Apple's result (fields staged /
 *     refusal reason) is reported verbatim — never a silent failure.
 *   • the CLI handoff stays as the credential-free secondary path; commands are
 *     copy targets, NEVER executed here, and stay [] until approval (server
 *     boundary).
 *   • the listing audit (findings / status facts / 🔒 locks) renders exactly
 *     what the run measured — the PRD 07 slice ported from the legacy dashboard.
 * Client + id injected for testability.
 */
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, ascCreateVersion, ascPush, decideRun, getCredentials, getGithubStatus, getRun, githubPr } from "@shipaso/api";
import type { AscPushResult, RunDetail } from "@shipaso/api";
import { CopyDiff } from "./CopyDiff.js";
import { FindingsCard } from "./FindingsCard.js";
import { OpportunitiesCard } from "./OpportunitiesCard.js";
import { LocalizationExpansionCard } from "./LocalizationExpansionCard.js";
import { CoverageCard } from "./CoverageCard.js";
import { PpoTreatmentCard } from "./PpoTreatmentCard.js";
import { ScreenshotPlanCard } from "./ScreenshotPlanCard.js";
import { CppSetsCard } from "./CppSetsCard.js";
import { LocalizationCard } from "./LocalizationCard.js";
import { DecisionSummary } from "./DecisionSummary.js";
import { RunStatusBar } from "./RunStatusBar.js";
import { RunDetailPane } from "./RunDetailPane.js";
import { SectionRail, type RailItem, type RailGroup } from "./SectionRail.js";
import { API_BASE } from "../../config.js";
import { runStatusLabel } from "../../lib/status.js";

/** The ShipASO MCP endpoint the agent connects to (absolute when an API base is
 *  configured, else a relative path in the demo build). */
const MCP_URL = `${API_BASE}/mcp`;

export function RunView({
  client,
  id,
  onConnect,
}: {
  client: import("@shipaso/api").ApiClient;
  id: string;
  onConnect?: () => void;
}) {
  const qc = useQueryClient();
  const runQ = useQuery({ queryKey: ["run", id], queryFn: () => getRun(client, id) });
  const credsQ = useQuery({ queryKey: ["credentials"], queryFn: () => getCredentials(client) });
  const decide = useMutation({
    mutationFn: (d: "approve" | "reject") => decideRun(client, id, d),
    // The decision is a SLIM partial (no `result`/`currentCopy`) — MERGE it onto
    // the cached RunDetail. Replacing outright dropped `result` and crashed the
    // diff on re-render. currentCopy is preserved; status + the revealed
    // pushCommands + any finalized proposedCopy are updated.
    onSuccess: (decision) =>
      qc.setQueryData<RunDetail>(["run", id], (prev) =>
        prev
          ? {
              ...prev,
              status: decision.status,
              result: {
                ...prev.result,
                ...(decision.proposedCopy ? { proposedCopy: decision.proposedCopy } : {}),
                pushCommands: decision.pushCommands,
              },
            }
          : prev,
      ),
  });
  // No invalidation on purpose: ascPush writes to App Store Connect, not to our
  // runs table (see the handler in cloud/src/api — it reads the run, mints a JWT,
  // and pushes; it never UPDATEs it). So the run record is unchanged and there is
  // nothing stale to refetch. Same for createVersion below. react-doctor flags
  // both; both are false positives.
  const push = useMutation({ mutationFn: () => ascPush(client, id, {}) });
  const [versionString, setVersionString] = useState("");
  const createVersion = useMutation({
    mutationFn: () => ascCreateVersion(client, id, { versionString: versionString.trim() }),
  });
  // The GitHub metadata-PR path (#8) — a credential-free alternative to the CLI
  // handoff, offered only when a repo is connected. Best-effort status read.
  const githubQ = useQuery({ queryKey: ["github", "status"], queryFn: () => getGithubStatus(client), retry: false });
  const pr = useMutation({ mutationFn: () => githubPr(client, id) });

  // Presence booleans read defensively off possibly-undefined data — this must
  // run unconditionally, ABOVE the loading/error early returns below, so hook
  // order stays stable across renders (Rules of Hooks).
  const rMaybe = runQ.data?.result;
  const hasAudit = Boolean(rMaybe?.findings?.length || rMaybe?.locks?.length);
  const hasMetadata = Boolean(rMaybe?.coverage);
  const hasKeywords = Boolean(rMaybe?.opportunities?.length);
  const hasMarkets = Boolean(rMaybe?.localizationExpansion?.length);
  const hasScreenshots = Boolean(rMaybe?.audit?.screenshots);
  const hasPpo = Boolean(rMaybe?.ppoTreatment);

  // Master-detail selection — "changes" is always present, so it's the safe
  // default. Declared alongside the other hooks, ABOVE the early returns, to
  // keep hook order stable (Rules of Hooks).
  const [activeId, setActiveId] = useState("changes");

  // Derived grouping inputs, read defensively so the memo below stays hook-safe.
  const auditNeedsYou = Boolean(
    rMaybe?.findings?.some((f) => !f.context && (f.severity === "critical" || f.severity === "warn")),
  );
  const screenshotGrade = rMaybe?.audit?.screenshots?.grade ?? null;

  // Stable reference: SectionRail's effect re-subscribes IntersectionObserver
  // whenever `items` changes identity, so this must not be a fresh array on
  // every render — key the memo on the presence booleans, not `r` itself.
  const railItems: RailItem[] = useMemo(() => {
    const screenshotsGroup: RailGroup = screenshotGrade == null
      ? "fyi"
      : /^[AB]/.test(screenshotGrade)
        ? "healthy"
        : "needs";
    return [
      { id: "changes", label: "Changes", group: "changes" as RailGroup },
      ...(hasAudit ? [{ id: "audit", label: "Audit", group: (auditNeedsYou ? "needs" : "fyi") as RailGroup }] : []),
      ...(hasMetadata ? [{ id: "metadata", label: "Metadata", group: "fyi" as RailGroup }] : []),
      ...(hasKeywords ? [{ id: "keywords", label: "Keywords", group: "fyi" as RailGroup }] : []),
      ...(hasMarkets ? [{ id: "markets", label: "Markets", group: "fyi" as RailGroup }] : []),
      ...(hasPpo ? [{ id: "ppo", label: "PPO test", group: "fyi" as RailGroup }] : []),
      ...(hasScreenshots ? [{ id: "screenshots", label: "Screenshots", group: screenshotsGroup }] : []),
    ];
  }, [hasAudit, hasMetadata, hasKeywords, hasMarkets, hasPpo, hasScreenshots, auditNeedsYou, screenshotGrade]);

  if (runQ.isLoading) return <p className="muted">Loading run…</p>;
  if (runQ.isError || !runQ.data || !runQ.data.result)
    return <p className="muted">Couldn’t load this run.</p>;

  const run = runQ.data;
  const approved = run.status === "approved" || run.status === "shipped";
  const rejected = run.status === "rejected";
  // A superseded run is a dead iteration (a newer run replaced it) — it's NOT
  // pending, so it never shows Approve/Reject. Only a genuinely-open run is
  // actionable; everything terminal (decided or superseded) is read-only.
  const superseded = run.status === "superseded";
  const pending = !approved && !rejected && !superseded;
  const r = run.result;
  const tierLimited = decide.error instanceof ApiError && decide.error.isTierLimit;

  // The stored ASC key for THIS app (or an account-level one) backs one-click
  // push. Absent → the CLI handoff is the only path, exactly as before.
  const storedAscKey = (credsQ.data?.credentials ?? []).find(
    (c) => c.kind === "asc" && (c.appId === run.app_id || c.appId === null),
  );
  const pushResult: AscPushResult | undefined = push.data;

  // Section cards, keyed by rail id — identical JSX to what rendered inline
  // before; the pane is the container now, so the `id="..."` anchor wrappers
  // are gone. Only sections that are present get an entry.
  const sections: Record<string, ReactNode> = {
    changes: <CopyDiff current={r.currentCopy} proposed={r.proposedCopy} />,
    ...(hasAudit
      ? {
          audit: (
            <FindingsCard
              findings={r.findings ?? []}
              {...(r.locks !== undefined ? { locks: r.locks } : {})}
              {...(r.findingsSummary !== undefined ? { summary: r.findingsSummary } : {})}
              {...(onConnect ? { onConnect } : {})}
            />
          ),
        }
      : {}),
    ...(hasMetadata ? { metadata: <CoverageCard coverage={r.coverage!} /> } : {}),
    ...(hasKeywords ? { keywords: <OpportunitiesCard opportunities={r.opportunities!} /> } : {}),
    ...(hasMarkets
      ? { markets: <LocalizationExpansionCard recommendations={r.localizationExpansion!} /> }
      : {}),
    ...(hasPpo ? { ppo: <PpoTreatmentCard plan={r.ppoTreatment!} /> } : {}),
    ...(hasScreenshots
      ? {
          screenshots: (
            <>
              <ScreenshotPlanCard
                client={client}
                inputs={{
                  appName: r.proposedCopy.name ?? r.currentCopy.name ?? r.audit!.liveName ?? "",
                  ...(r.proposedCopy.subtitle ? { subtitle: r.proposedCopy.subtitle } : {}),
                  keywords: (r.proposedCopy.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean),
                  rawScreens: [],
                  audit: {
                    grade: r.audit!.screenshots!.grade,
                    // App Store minimum-strong set when the audit carries no explicit target.
                    recommendedCount: 6,
                    findings: r.audit!.screenshots!.findings ?? [],
                  },
                  brandPalette: [],
                }}
              />
              {(r.opportunities?.length ?? 0) >= 2 ? (
                <CppSetsCard
                  client={client}
                  inputs={{
                    appName: r.proposedCopy.name ?? r.currentCopy.name ?? r.audit!.liveName ?? "",
                    ...(r.proposedCopy.subtitle ? { subtitle: r.proposedCopy.subtitle } : {}),
                    keywords: (r.opportunities ?? []).map((o) => o.keyword).filter(Boolean),
                    rawScreens: [],
                    auditGrade: r.audit!.screenshots!.grade,
                    findings: r.audit!.screenshots!.findings ?? [],
                    brandPalette: [],
                    recommendedCount: 6,
                  }}
                />
              ) : null}
            </>
          ),
        }
      : {}),
  };

  if (pending) {
    return (
      <div className="run-layout">
        <h1>Proposed changes</h1>
        <RunStatusBar
          appName={r.audit?.liveName ?? r.currentCopy.name ?? "—"}
          grade={r.audit?.screenshots?.grade ?? null}
          coverageScore={r.coverage?.coverageScore ?? null}
          status={run.status}
          {...(onConnect ? { onConnectAnalytics: onConnect } : {})}
        />
        <DecisionSummary current={r.currentCopy} proposed={r.proposedCopy} findings={r.findings ?? []} />
        <div className="run-shell">
          <SectionRail items={railItems} activeId={activeId} onSelect={setActiveId} />
          <RunDetailPane activeId={activeId} sections={sections} />
        </div>
        {!tierLimited ? (
          <div className="decision-bar" data-testid="decision-bar">
            <span className="db-summary micro muted">
              {(() => {
                const added = (r.proposedCopy.keywords ?? "").split(",").map((s) => s.trim()).filter(Boolean).length;
                const needsYou = r.findings?.filter((f) => !f.context && (f.severity === "critical" || f.severity === "warn")).length ?? 0;
                return `${needsYou} to review · ${added} keywords`;
              })()}
            </span>
            <span className="db-actions">
              <button type="button" className="btn ghost" data-testid="reject" disabled={decide.isPending} onClick={() => decide.mutate("reject")}>
                Reject
              </button>
              <button type="button" className="btn primary" data-testid="approve" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
                {decide.isPending ? "Approving…" : "Approve changes"}
              </button>
            </span>
          </div>
        ) : null}
        {tierLimited ? (
          <p className="muted" data-testid="tier-limit">
            You’ve hit your plan’s run limit — upgrade to approve more.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="run-layout">
      <section className="run-main">
        <h1>Proposed changes</h1>
        <CopyDiff current={r.currentCopy} proposed={r.proposedCopy} />

        {hasAudit ? (
          <FindingsCard
            findings={r.findings ?? []}
            {...(r.locks !== undefined ? { locks: r.locks } : {})}
            {...(r.findingsSummary !== undefined ? { summary: r.findingsSummary } : {})}
            {...(onConnect ? { onConnect } : {})}
          />
        ) : null}

        {hasMetadata ? <CoverageCard coverage={r.coverage!} /> : null}
        {hasKeywords ? <OpportunitiesCard opportunities={r.opportunities!} /> : null}
        {hasMarkets ? <LocalizationExpansionCard recommendations={r.localizationExpansion!} /> : null}
        {r.ppoTreatment ? <PpoTreatmentCard plan={r.ppoTreatment} /> : null}
        {hasScreenshots ? (
          <>
            <ScreenshotPlanCard
              client={client}
              inputs={{
                appName: r.proposedCopy.name ?? r.currentCopy.name ?? r.audit!.liveName ?? "",
                ...(r.proposedCopy.subtitle ? { subtitle: r.proposedCopy.subtitle } : {}),
                keywords: (r.proposedCopy.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean),
                rawScreens: [],
                audit: {
                  grade: r.audit!.screenshots!.grade,
                  // App Store minimum-strong set when the audit carries no explicit target.
                  recommendedCount: 6,
                  findings: r.audit!.screenshots!.findings ?? [],
                },
                brandPalette: [],
              }}
            />
            {(r.opportunities?.length ?? 0) >= 2 ? (
              <CppSetsCard
                client={client}
                inputs={{
                  appName: r.proposedCopy.name ?? r.currentCopy.name ?? r.audit!.liveName ?? "",
                  ...(r.proposedCopy.subtitle ? { subtitle: r.proposedCopy.subtitle } : {}),
                  keywords: (r.opportunities ?? []).map((o) => o.keyword).filter(Boolean),
                  rawScreens: [],
                  auditGrade: r.audit!.screenshots!.grade,
                  findings: r.audit!.screenshots!.findings ?? [],
                  brandPalette: [],
                  recommendedCount: 6,
                }}
              />
            ) : null}
          </>
        ) : null}

        <p className={"run-status" + (approved ? " good" : "")} data-testid="run-status">
          {runStatusLabel(run.status)}
        </p>

        {tierLimited ? (
          <p className="muted" data-testid="tier-limit">
            You’ve hit your plan’s run limit — upgrade to approve more.
          </p>
        ) : null}

      {approved && storedAscKey ? (
        <div className="card" data-testid="asc-push-card">
          <b>Push to App Store Connect</b>
          <p className="micro">
            Uses your saved key ({storedAscKey.keyId}) to stage the approved copy on your
            editable version. Explicit click — nothing is automatic.
          </p>
          <button type="button"
            className="btn primary"
            data-testid="asc-push"
            disabled={push.isPending}
            onClick={() => push.mutate()}
          >
            {push.isPending ? "Pushing…" : "Push to App Store Connect"}
          </button>
          {pushResult ? (
            <p className="micro" data-testid="push-result">
              {pushResult.ok
                ? `Staged on your editable version: ${pushResult.fieldsPushed.join(", ")}.`
                : `App Store Connect refused the push: ${pushResult.reason}`}
            </p>
          ) : null}
          {push.isError ? (
            <p className="micro" data-testid="push-result">
              {push.error instanceof Error ? push.error.message : "Push failed."}
            </p>
          ) : null}

          {/* Dead-end fix (#34): a refused push is most often "no editable version".
              Offer to create a draft version right here, then push again — no curl. */}
          {pushResult && !pushResult.ok ? (
            <div data-testid="create-version" style={{ marginTop: 10 }}>
              <p className="micro">
                No editable version to push to? Create a draft (state PREPARE_FOR_SUBMISSION)
                with your saved key, then push again.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  data-testid="cv-version"
                  placeholder="e.g. 1.2.0"
                  value={versionString}
                  onChange={(e) => setVersionString(e.target.value)}
                />
                <button type="button"
                  className="btn ghost"
                  data-testid="cv-create"
                  disabled={createVersion.isPending || !versionString.trim()}
                  onClick={() => createVersion.mutate()}
                >
                  {createVersion.isPending ? "Creating…" : "Create draft version"}
                </button>
              </div>
              {createVersion.data ? (
                <p className="micro" data-testid="cv-result">
                  {createVersion.data.ok
                    ? `Created draft ${createVersion.data.versionString} (${createVersion.data.state}). Push again to stage your copy.`
                    : `App Store Connect refused: ${createVersion.data.reason}`}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {approved ? (
        <LocalizationCard client={client} runId={id} initialLocales={Object.keys(r.localizedCopy ?? {}).sort()} />
      ) : null}

      {approved && githubQ.data?.connected ? (
        <div className="card" data-testid="github-pr-card">
          <b>Open a metadata PR</b>
          <p className="micro">
            Credential-free: opens a pull request with the approved copy on your connected repo
            ({githubQ.data.repo}). Review + merge it yourself — nothing ships from here.
          </p>
          <button type="button"
            className="btn primary"
            data-testid="github-pr"
            disabled={pr.isPending}
            onClick={() => pr.mutate()}
          >
            {pr.isPending ? "Opening…" : "Open pull request"}
          </button>
          {pr.data ? (
            <p className="micro" data-testid="github-pr-result">
              {pr.data.ok ? (
                <a href={pr.data.url} target="_blank" rel="noreferrer">Opened PR #{pr.data.number} on {pr.data.branch} →</a>
              ) : (
                `GitHub refused: ${pr.data.reason}`
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {approved && r.pushCommands.length > 0 ? (
        <div className="card handoff" data-testid="handoff">
          <b>{storedAscKey ? "Prefer the CLI?" : "Handoff commands"}</b>
          <p className="micro">
            Run these yourself for the credential-free path — nothing ships without your
            explicit action. Approval reveals them; nothing has shipped yet.
          </p>
          {r.pushCommands.map((c, i) => (
            <div key={i} className="cmd-block">
              <p className="micro">
                <span className={"store-tag " + c.store}>{c.store}</span> {c.description}
              </p>
              <pre>{c.command}</pre>
            </div>
          ))}
        </div>
      ) : null}

      {approved ? (
        <div className="card" data-testid="mcp-handoff">
          <b>Run it from your AI agent</b>
          <p className="micro">
            Connect the ShipASO MCP and your agent can drive the audit → propose loop over
            this app. Draft-only: the agent can’t push — approving + shipping stay here.
          </p>
          <pre>{`claude mcp add shipaso --transport http ${MCP_URL} \\
  --header "Authorization: Bearer <your shipaso_ key>"`}</pre>
          <p className="micro muted" style={{ margin: "4px 0 0" }}>
            Generate a key in Settings → Agent access.{" "}
            {onConnect ? (
              <button type="button" className="btn ghost" data-testid="mcp-settings" onClick={onConnect}>
                Open Settings →
              </button>
            ) : (
              <a className="btn ghost" data-testid="mcp-settings" href="/settings">
                Open Settings →
              </a>
            )}
          </p>
        </div>
      ) : null}
      </section>
    </div>
  );
}
