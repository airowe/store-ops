/**
 * Connect GitHub (#8) — the metadata-PR path, previously curl-only. Link your
 * ShipASO GitHub App installation + a target repo (owner/name); an approved run
 * can then open a metadata PR instead of the Fastlane download.
 *
 * Honest: the installation id + repo are not secrets (we say so); the card is
 * inert when the deployment hasn't configured the GitHub App, and disconnect is
 * immediate. Read-only status drives what's shown — never an optimistic guess.
 *
 * Renders as a connection row inside the Connections panel: chip / name + meta /
 * status pill / action. All three states (unconfigured, not connected,
 * connected) share that one shape.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { connectGithub, getGithubStatus } from "@shipaso/api";

export function GithubCard({ client }: { client: ApiClient }) {
  const qc = useQueryClient();
  const statusQ = useQuery({ queryKey: ["github", "status"], queryFn: () => getGithubStatus(client), retry: false });
  const [installationId, setInstallationId] = useState("");
  const [repo, setRepo] = useState("");
  const [revealed, setRevealed] = useState(false);

  const connect = useMutation({
    mutationFn: (body: { installation_id?: string; repo?: string }) => connectGithub(client, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["github", "status"] }),
  });

  if (statusQ.isLoading || !statusQ.data) return null;
  const { appConfigured, connected, repo: linkedRepo } = statusQ.data;

  // The GitHub App isn't set up on this deployment — the path is inert, but the
  // row keeps its shape so Connections doesn't develop a hole.
  if (!appConfigured) {
    return (
      <div data-testid="github-card">
        <div className="conn-row">
          <span className="conn-chip" aria-hidden="true">
            ⎇
          </span>
          <div className="conn-main">
            <div className="conn-name">GitHub</div>
            <div className="conn-meta">Not configured on this deployment</div>
          </div>
          <span className="status-pill" data-testid="gh-status-pill">
            Optional
          </span>
        </div>
        <p className="conn-note" data-testid="gh-unconfigured">
          The metadata-PR path isn’t configured on this deployment. Use the Fastlane download instead.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="github-card">
      <div className="conn-row">
        <span className="conn-chip" aria-hidden="true">
          ⎇
        </span>
        <div className="conn-main">
          <div className="conn-name">GitHub</div>
          {connected ? (
            <div className="conn-meta" data-testid="gh-connected">
              Connected to <span className="mono">{linkedRepo}</span>
            </div>
          ) : (
            <div className="conn-meta">Not connected · installation id + repo</div>
          )}
        </div>
        <span className={`status-pill${connected ? " is-on" : ""}`} data-testid="gh-status-pill">
          {connected ? "Connected" : "Optional"}
        </span>
        {connected ? (
          <button
            type="button"
            className="btn bad"
            data-testid="gh-disconnect"
            disabled={connect.isPending}
            onClick={() => connect.mutate({})}
          >
            {connect.isPending ? "…" : "Disconnect"}
          </button>
        ) : (
          <button
            type="button"
            className="btn ghost"
            data-testid="gh-reveal"
            onClick={() => setRevealed((v) => !v)}
          >
            Connect
          </button>
        )}
      </div>

      {connected ? (
        <p className="conn-note">Approved runs can open a metadata PR.</p>
      ) : (
        <>
          <p className="conn-note">
            Link your ShipASO GitHub App installation and a target repo to open metadata PRs from an
            approved run. Neither the installation id nor the repo name is a secret.
          </p>
          {revealed ? (
            <div className="conn-form">
              <input
                className="txt"
                data-testid="gh-installation"
                placeholder="Installation ID"
                value={installationId}
                onChange={(e) => setInstallationId(e.target.value)}
              />
              <input
                className="txt"
                data-testid="gh-repo"
                placeholder="Repo (owner/name)"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
              />
              <button
                type="button"
                className="btn primary"
                data-testid="gh-connect"
                disabled={connect.isPending || !installationId.trim() || !/^[^/\s]+\/[^/\s]+$/.test(repo.trim())}
                onClick={() => connect.mutate({ installation_id: installationId.trim(), repo: repo.trim() })}
              >
                {connect.isPending ? "Connecting…" : "Connect"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
