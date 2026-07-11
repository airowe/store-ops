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
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, ascCreateVersion, ascPush, decideRun, getCredentials, getGithubStatus, getRun, githubPr } from "@shipaso/api";
import type { AscPushResult, RunDetail } from "@shipaso/api";
import { CopyDiff } from "./CopyDiff.js";
import { FindingsCard } from "./FindingsCard.js";

export function RunView({ client, id }: { client: import("@shipaso/api").ApiClient; id: string }) {
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
  const push = useMutation({ mutationFn: () => ascPush(client, id, {}) });
  const [versionString, setVersionString] = useState("");
  const createVersion = useMutation({
    mutationFn: () => ascCreateVersion(client, id, { versionString: versionString.trim() }),
  });
  // The GitHub metadata-PR path (#8) — a credential-free alternative to the CLI
  // handoff, offered only when a repo is connected. Best-effort status read.
  const githubQ = useQuery({ queryKey: ["github", "status"], queryFn: () => getGithubStatus(client), retry: false });
  const pr = useMutation({ mutationFn: () => githubPr(client, id) });

  if (runQ.isLoading) return <p className="muted">Loading run…</p>;
  if (runQ.isError || !runQ.data || !runQ.data.result)
    return <p className="muted">Couldn’t load this run.</p>;

  const run = runQ.data;
  const approved = run.status === "approved" || run.status === "shipped";
  const rejected = run.status === "rejected";
  const pending = !approved && !rejected;
  const r = run.result;
  const tierLimited = decide.error instanceof ApiError && decide.error.isTierLimit;

  // The stored ASC key for THIS app (or an account-level one) backs one-click
  // push. Absent → the CLI handoff is the only path, exactly as before.
  const storedAscKey = (credsQ.data?.credentials ?? []).find(
    (c) => c.kind === "asc" && (c.appId === run.app_id || c.appId === null),
  );
  const pushResult: AscPushResult | undefined = push.data;

  return (
    <section>
      <h1>Proposed changes</h1>
      <CopyDiff current={r.currentCopy} proposed={r.proposedCopy} />

      {(r.findings?.length || r.locks?.length) ? (
        <FindingsCard
          findings={r.findings ?? []}
          {...(r.locks !== undefined ? { locks: r.locks } : {})}
          {...(r.findingsSummary !== undefined ? { summary: r.findingsSummary } : {})}
        />
      ) : null}

      {pending ? (
        <div className="btn-row" style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button className="btn primary" data-testid="approve" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
            {decide.isPending ? "Approving…" : "Approve"}
          </button>
          <button className="btn ghost" data-testid="reject" disabled={decide.isPending} onClick={() => decide.mutate("reject")}>
            Reject
          </button>
        </div>
      ) : (
        <p className={"run-status" + (approved ? " good" : "")} data-testid="run-status">
          {approved ? "Approved · ready to push" : "Rejected"}
        </p>
      )}

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
          <button
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
                <button
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

      {approved && githubQ.data?.connected ? (
        <div className="card" data-testid="github-pr-card">
          <b>Open a metadata PR</b>
          <p className="micro">
            Credential-free: opens a pull request with the approved copy on your connected repo
            ({githubQ.data.repo}). Review + merge it yourself — nothing ships from here.
          </p>
          <button
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
    </section>
  );
}
