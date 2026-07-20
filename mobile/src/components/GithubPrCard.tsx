/**
 * GithubPrCard (#8) — the credential-free ship action on an approved run. When a
 * repo is connected, open a pull request with the approved copy on it; review +
 * merge it yourself — nothing ships from here.
 *
 * Honest: present only when the run is approved AND a repo is connected (no dead
 * button); a successful PR surfaces the real URL/number/branch (opened via
 * Linking); a refusal is shown verbatim, never swallowed.
 */
import { useState } from "react";
import * as Linking from "expo-linking";
import type { ApiClient } from "../api/client.js";
import { githubPr } from "../api/endpoints.js";
import type { GithubPrResult } from "../types/api.js";
import { palette, spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";

export function GithubPrCard({
  client,
  runId,
  approved,
  connected,
  repo,
}: {
  client: ApiClient;
  runId: string;
  approved: boolean;
  connected: boolean;
  repo: string | null;
}) {
  const [result, setResult] = useState<GithubPrResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!approved || !connected) return null;

  async function open() {
    setBusy(true);
    setError(null);
    try {
      setResult(await githubPr(client, runId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t open the pull request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <AppText kind="lead">Open a metadata PR</AppText>
      <AppText kind="micro">
        Credential-free: opens a pull request with the approved copy on your connected repo
        {repo ? ` (${repo})` : ""}. Review + merge it yourself — nothing ships from here.
      </AppText>
      <Button
        testID="github-pr"
        label="Open pull request"
        loading={busy}
        onPress={() => void open()}
      />

      {result ? (
        <AppText kind="micro" testID="github-pr-result" style={{ marginTop: spacing.sm }}>
          {result.ok
            ? `Opened PR #${result.number} on ${result.branch}.`
            : `GitHub refused: ${result.reason}`}
        </AppText>
      ) : null}
      {result?.ok ? (
        <Button
          testID="github-pr-open"
          label="View pull request ↗"
          variant="ghost"
          onPress={() => void Linking.openURL(result.url)}
        />
      ) : null}

      {error ? (
        <AppText kind="micro" testID="github-pr-error" style={{ color: palette.bad }}>
          {error}
        </AppText>
      ) : null}
    </Card>
  );
}
