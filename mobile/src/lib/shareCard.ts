/**
 * Share-a-win — download the server-rendered share-card SVG (auth-gated) and hand
 * it to the OS share sheet. The route returns 404 when there's no REAL win to
 * show (we never dress up a hold or a slip), which we surface honestly so the
 * button only "fires" on a genuine win. Injectable deps keep it unit-testable.
 */
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { apiBase } from "./config.js";
import { getToken } from "../auth/session.js";
import { shareCardUrl } from "../api/endpoints.js";

export type ShareCardDeps = {
  downloadAsync: typeof FileSystem.downloadAsync;
  cacheDir: string | null;
  isAvailableAsync: typeof Sharing.isAvailableAsync;
  shareAsync: typeof Sharing.shareAsync;
  getToken: () => Promise<string | null>;
  base: string;
};

function defaultDeps(): ShareCardDeps {
  return {
    downloadAsync: FileSystem.downloadAsync,
    cacheDir: FileSystem.cacheDirectory,
    isAvailableAsync: Sharing.isAvailableAsync,
    shareAsync: Sharing.shareAsync,
    getToken,
    base: apiBase(),
  };
}

export type ShareCardResult = { ok: true; uri: string } | { ok: false; reason: string };

export async function shareWin(
  appId: string,
  size: "wide" | "square" = "wide",
  deps: ShareCardDeps = defaultDeps(),
): Promise<ShareCardResult> {
  const token = await deps.getToken();
  if (!token) return { ok: false, reason: "Sign in to share a win." };
  if (!deps.cacheDir) return { ok: false, reason: "No writable cache directory." };

  const url = shareCardUrl(deps.base, appId, size);
  const target = `${deps.cacheDir}share-${appId}.svg`;
  const res = await deps.downloadAsync(url, target, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 404) return { ok: false, reason: "No real win to share yet." };
  if (res.status !== 200) return { ok: false, reason: `Couldn’t build the card (${res.status}).` };

  if (await deps.isAvailableAsync()) {
    await deps.shareAsync(res.uri, { mimeType: "image/svg+xml", dialogTitle: "Share your win" });
  }
  return { ok: true, uri: res.uri };
}
