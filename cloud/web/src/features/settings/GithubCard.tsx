/**
 * Connect GitHub (#8) — the metadata-PR path, previously curl-only. Link your
 * ShipASO GitHub App installation + a target repo (owner/name); an approved run
 * can then open a metadata PR instead of the Fastlane download.
 *
 * Honest: the installation id + repo are not secrets (we say so); the card is
 * inert when the deployment hasn't configured the GitHub App, and disconnect is
 * immediate. Read-only status drives what's shown — never an optimistic guess.
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

  const connect = useMutation({
    mutationFn: (body: { installation_id?: string; repo?: string }) => connectGithub(client, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["github", "status"] }),
  });

  if (statusQ.isLoading || !statusQ.data) return null;
  const { appConfigured, connected, repo: linkedRepo } = statusQ.data;

  // The GitHub App isn't set up on this deployment — the path is inert.
  if (!appConfigured) {
    return (
      <div className="card" data-testid="github-card">
        <b>GitHub</b>
        <p className="micro" data-testid="gh-unconfigured">
          The metadata-PR path isn’t configured on this deployment. Use the Fastlane download instead.
        </p>
      </div>
    );
  }

  return (
    <div className="card" data-testid="github-card">
      <b>GitHub</b>
      {connected ? (
        <>
          <p className="micro" data-testid="gh-connected">
            Connected to <span className="mono">{linkedRepo}</span>. Approved runs can open a metadata PR.
          </p>
          <button
            className="btn bad"
            data-testid="gh-disconnect"
            disabled={connect.isPending}
            onClick={() => connect.mutate({})}
          >
            {connect.isPending ? "…" : "Disconnect"}
          </button>
        </>
      ) : (
        <>
          <p className="micro">
            Link your ShipASO GitHub App installation and a target repo to open metadata PRs from an
            approved run. Neither the installation id nor the repo name is a secret.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            <input data-testid="gh-installation" placeholder="Installation ID" value={installationId} onChange={(e) => setInstallationId(e.target.value)} />
            <input data-testid="gh-repo" placeholder="Repo (owner/name)" value={repo} onChange={(e) => setRepo(e.target.value)} />
            <button
              className="btn primary"
              data-testid="gh-connect"
              disabled={connect.isPending || !installationId.trim() || !/^[^/\s]+\/[^/\s]+$/.test(repo.trim())}
              onClick={() => connect.mutate({ installation_id: installationId.trim(), repo: repo.trim() })}
            >
              {connect.isPending ? "Connecting…" : "Connect"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
