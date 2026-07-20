/**
 * GithubCard (#8) — the credential-free metadata-PR path. Link your ShipASO
 * GitHub App installation + a target repo (owner/name); an approved run can then
 * open a metadata PR instead of the Fastlane download.
 *
 * Honest: the installation id + repo are not secrets (we say so); the card is
 * INERT when the deployment hasn't configured the GitHub App; read-only status
 * drives what's shown — never an optimistic guess. Disconnect is immediate.
 */
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { connectGithub, getGithubStatus } from "../api/endpoints.js";
import type { GithubStatus } from "../types/api.js";
import { palette, spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";
import { TextField } from "./TextField.js";

/** A repo must read as owner/name — a mistyped value can't reach the server. */
const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

export function GithubCard({ client }: { client: ApiClient }) {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [installationId, setInstallationId] = useState("");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getGithubStatus(client));
    } catch {
      // A status read failure leaves the card hidden rather than guessing state.
      setStatus(null);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function mutate(body: { installation_id?: string; repo?: string }) {
    setBusy(true);
    setError(null);
    try {
      const r = await connectGithub(client, body);
      setStatus((s) => (s ? { ...s, connected: r.connected, repo: r.repo } : s));
      if (!r.connected) {
        setInstallationId("");
        setRepo("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t update the GitHub connection.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  // The GitHub App isn't set up on this deployment — the path is inert.
  if (!status.appConfigured) {
    return (
      <Card>
        <AppText kind="lead">GitHub</AppText>
        <AppText kind="micro" testID="gh-unconfigured">
          The metadata-PR path isn’t configured on this deployment. Use the Fastlane download instead.
        </AppText>
      </Card>
    );
  }

  return (
    <Card>
      <AppText kind="lead">GitHub</AppText>
      {status.connected ? (
        <>
          <AppText kind="micro" testID="gh-connected">
            Connected to {status.repo}. Approved runs can open a metadata PR.
          </AppText>
          <Button
            testID="gh-disconnect"
            label="Disconnect"
            variant="ghost"
            loading={busy}
            onPress={() => void mutate({})}
          />
        </>
      ) : (
        <>
          <AppText kind="micro">
            Link your ShipASO GitHub App installation and a target repo to open metadata PRs from an
            approved run. Neither the installation id nor the repo name is a secret.
          </AppText>
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            <TextField
              testID="gh-installation"
              value={installationId}
              onChangeText={setInstallationId}
              placeholder="Installation ID"
            />
            <TextField
              testID="gh-repo"
              value={repo}
              onChangeText={setRepo}
              placeholder="Repo (owner/name)"
            />
            <Button
              testID="gh-connect"
              label="Connect"
              loading={busy}
              disabled={!installationId.trim() || !REPO_RE.test(repo.trim())}
              onPress={() => void mutate({ installation_id: installationId.trim(), repo: repo.trim() })}
            />
          </View>
        </>
      )}
      {error ? (
        <AppText kind="micro" testID="gh-error" style={{ color: palette.bad }}>
          {error}
        </AppText>
      ) : null}
    </Card>
  );
}
