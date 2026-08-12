/**
 * Share-a-win, web edition — fetch the server-rendered share-card SVG and hand
 * the browser a PNG to save. The native app does the same thing through the OS
 * share sheet (`mobile/src/lib/shareCard.ts`); a browser has no share sheet, so
 * the equivalent terminal action is a download.
 *
 * Why this does NOT go through `@shipaso/api`'s client: that client parses every
 * response as JSON. The card is `image/svg+xml`, so routing it through `get()`
 * would throw a parse error on a perfectly good card — reporting "no win" when
 * a win rendered. A raw fetch with `credentials: "include"` uses the same cookie
 * session and lets us read the STATUS, which is where the honesty lives:
 *
 *   404 → there is genuinely no win to share (a hold or a slip). Not an error.
 *   200 → a real climb or a strong new entry.
 *
 * We never dress up a non-result, so a 404 surfaces as plain copy and no file.
 * Deps are injected so the whole path is testable without a DOM canvas.
 */
import { API_BASE } from "../config.js";

export type ShareWinDeps = {
  fetchImpl: typeof fetch;
  /** SVG string → PNG blob. Injected so tests need no real canvas. */
  rasterize: (svg: string) => Promise<Blob>;
  /** Hand the finished file to the user (a download in the browser). */
  save: (blob: Blob, filename: string) => void;
  base: string;
};

/**
 * `noWin` separates the two ways this can fail to produce a file. A 404 is a
 * MEASURED answer — the app is holding or slipping, so there is nothing honest
 * to brag about — and the UI must not dress that up as a malfunction. Everything
 * else (auth, transport, render) genuinely went wrong and says nothing about the
 * rankings. Carrying the distinction as a field rather than re-deriving it from
 * the copy means rewording a message can never silently change its meaning.
 */
export type ShareWinResult =
  | { ok: true; filename: string }
  | { ok: false; reason: string; noWin: boolean };

export const shareCardPath = (appId: string, size: "wide" | "square") =>
  `/apps/${encodeURIComponent(appId)}/share-card.svg?size=${size}`;

function defaultDeps(): ShareWinDeps {
  return { fetchImpl: fetch, rasterize: rasterizeSvg, save: saveBlob, base: API_BASE };
}

export async function shareWin(
  appId: string,
  size: "wide" | "square" = "wide",
  over: Partial<ShareWinDeps> = {},
): Promise<ShareWinResult> {
  const deps = { ...defaultDeps(), ...over };
  const filename = `shipaso-win-${appId}.png`;

  let res: Response;
  try {
    res = await deps.fetchImpl(deps.base + shareCardPath(appId, size), {
      credentials: "include",
      headers: { accept: "image/svg+xml" },
    });
  } catch {
    return { ok: false, reason: "Couldn’t reach the server. Check your connection.", noWin: false };
  }

  // Each status is a distinct answer. Collapsing them would let a transport or
  // auth problem masquerade as "you have no win", which is a claim about the
  // user's rankings that we would not have measured.
  if (res.status === 404) return { ok: false, reason: "No real win to share yet.", noWin: true };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "Sign in to share a win.", noWin: false };
  if (!res.ok) return { ok: false, reason: `Couldn’t build the card (${res.status}).`, noWin: false };

  const svg = await res.text();
  if (!svg.trim()) return { ok: false, reason: "The card came back empty — try again.", noWin: false };

  let png: Blob;
  try {
    png = await deps.rasterize(svg);
  } catch {
    return { ok: false, reason: "Couldn’t render the card in this browser.", noWin: false };
  }

  deps.save(png, filename);
  return { ok: true, filename };
}

/**
 * Rasterize a self-contained SVG to PNG via canvas. The card embeds no external
 * fonts or images (`cloud/src/shareCard.ts`), so the canvas never taints and
 * `toBlob` stays readable — the same property that lets the posting edge use
 * resvg without a browser.
 */
export async function rasterizeSvg(svg: string, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("could not decode the card SVG"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas context");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas produced no blob"))), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Browser equivalent of the OS share sheet: hand over a file. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
