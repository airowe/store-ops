/**
 * Fastlane metadata handoff — download the run's `fastlane.zip` and hand it to the
 * OS share sheet. The route is auth-gated, so a plain browser-open won't work (no
 * Bearer header); we download with the token via expo-file-system, then share via
 * expo-sharing. The file is the deliverable for the user's OWN fastlane run —
 * ShipASO never pushes to a live store itself.
 *
 * Injectable deps (fs/sharing/getToken) keep it unit-testable headlessly.
 */
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { apiBase } from "./config.js";
import { getToken } from "../auth/session.js";
import { fastlaneZipUrl } from "../api/endpoints.js";

export type FastlaneDeps = {
  downloadAsync: typeof FileSystem.downloadAsync;
  cacheDir: string | null;
  isAvailableAsync: typeof Sharing.isAvailableAsync;
  shareAsync: typeof Sharing.shareAsync;
  getToken: () => Promise<string | null>;
  base: string;
};

function defaultDeps(): FastlaneDeps {
  return {
    downloadAsync: FileSystem.downloadAsync,
    cacheDir: FileSystem.cacheDirectory,
    isAvailableAsync: Sharing.isAvailableAsync,
    shareAsync: Sharing.shareAsync,
    getToken,
    base: apiBase(),
  };
}

export type FastlaneResult = { ok: true; uri: string } | { ok: false; reason: string };

/**
 * Download `runs/:id/fastlane.zip` (Bearer-authed) and share it. Returns an honest
 * result rather than throwing, so the screen can surface a clear message.
 */
export async function downloadAndShareFastlane(runId: string, deps: FastlaneDeps = defaultDeps()): Promise<FastlaneResult> {
  const token = await deps.getToken();
  if (!token) return { ok: false, reason: "Sign in to download the metadata." };
  if (!deps.cacheDir) return { ok: false, reason: "No writable cache directory." };

  const url = fastlaneZipUrl(deps.base, runId);
  const target = `${deps.cacheDir}fastlane-${runId}.zip`;

  const res = await deps.downloadAsync(url, target, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) return { ok: false, reason: `Download failed (${res.status}).` };

  if (await deps.isAvailableAsync()) {
    await deps.shareAsync(res.uri, { mimeType: "application/zip", dialogTitle: "fastlane metadata" });
  }
  return { ok: true, uri: res.uri };
}
