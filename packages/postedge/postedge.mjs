/**
 * The #BuildInPublic posting edge — the piece that turns a confirmed rank win
 * into an actual X post. The Worker composes and PROVES the win
 * (`GET /apps/:id/buildinpublic-post`, #445) but never touches X; this edge
 * fetches that composed post, rasterizes the proof card to PNG, and hands both
 * to the posting command (the `bird` skill) when one is connected.
 *
 * Honesty + idempotency contract:
 *   • The server's 404 ("no rank win to post yet") is a RESULT, not an error —
 *     post nothing, write nothing.
 *   • A win is identified by the digest of its composed text (the composer is
 *     pure, so the same win always composes identically). Only a SUCCESSFUL
 *     post records the win in the state file; a prepared-but-unposted or failed
 *     attempt leaves it eligible, so connecting the X account later — or a
 *     transient X outage — never loses a win.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rasterizePng } from "./rasterize.mjs";

/** The dedup identity of a win: sha-256 of its composed post text. */
export function winKey(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Fetch the composed post for one app, or null when there is no genuine win.
 * Any non-404 failure throws with the status — a misconfigured key must read
 * as "unauthorized", never as "no win this week".
 *
 * @returns {Promise<{ text: string, hashtags: string[], cardSvg: string } | null>}
 */
export async function fetchBuildInPublicPost({ base, apiKey, appId, storeUrl }, fetchImpl = fetch) {
  const url = `${base}/apps/${appId}/buildinpublic-post?storeUrl=${encodeURIComponent(storeUrl)}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`buildinpublic-post for ${appId} failed: HTTP ${res.status} — ${await res.text()}`);
  }
  return await res.json();
}

async function loadState(statePath) {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return { version: 1, apps: {} };
  }
}

/**
 * One posting pass for one app. Returns the outcome:
 *   { status: "no-win" }                        — server says nothing to brag about
 *   { status: "duplicate" }                     — this exact win already posted
 *   { status: "prepared", outboxDir, text }     — outbox written; no post command connected
 *   { status: "posted",   outboxDir, text }     — bird ran; win recorded in state
 *
 * @param {{ base: string, apiKey: string, appId: string, storeUrl: string,
 *           outDir: string, statePath: string }} opts
 * @param {{ fetchImpl?: typeof fetch,
 *           post?: (textPath: string, pngPath: string) => Promise<void>,
 *           now?: () => Date }} [deps]
 */
export async function runPostEdge(opts, deps = {}) {
  const { fetchImpl = fetch, post = null, now = () => new Date() } = deps;
  const found = await fetchBuildInPublicPost(opts, fetchImpl);
  if (found === null) return { status: "no-win" };

  const key = winKey(found.text);
  const state = await loadState(opts.statePath);
  if (state.apps[opts.appId]?.key === key) return { status: "duplicate" };

  // Outbox per win: bird gets real files, and a new win never clobbers the
  // last one's evidence.
  const outboxDir = join(opts.outDir, `${opts.appId}-${key.slice(0, 12)}`);
  await mkdir(outboxDir, { recursive: true });
  const textPath = join(outboxDir, "post.txt");
  const pngPath = join(outboxDir, "card.png");
  await writeFile(textPath, `${found.text}\n`, "utf8");
  await writeFile(pngPath, rasterizePng(found.cardSvg));

  if (!post) return { status: "prepared", outboxDir, text: found.text };

  // A throwing post command propagates BEFORE the state write — the win stays
  // eligible and the next run retries.
  await post(textPath, pngPath);
  state.apps[opts.appId] = { key, text: found.text, postedAt: now().toISOString() };
  await writeFile(opts.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return { status: "posted", outboxDir, text: found.text };
}

const USAGE =
  "usage: shipaso-postedge --app <appId> --store-url <https://…> " +
  "[--state <file>] [--out <dir>] [--post-cmd <cmd>]   (SHIPASO_API_KEY required in env)";

/**
 * Parse CLI args + env into runPostEdge options. The API key is environment-
 * only — a key on the command line lands in shell history and process lists.
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function parseCliArgs(argv, env) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error(USAGE);
    flags[name.slice(2)] = value;
  }
  const apiKey = env.SHIPASO_API_KEY;
  if (!apiKey) throw new Error(`SHIPASO_API_KEY is not set. ${USAGE}`);
  if (!flags.app) throw new Error(`--app is required. ${USAGE}`);
  if (!flags["store-url"]) throw new Error(`--store-url is required. ${USAGE}`);
  if (!/^https:\/\//.test(flags["store-url"])) {
    throw new Error(`--store-url must be https (got "${flags["store-url"]}"). ${USAGE}`);
  }
  return {
    base: env.SHIPASO_API_BASE ?? "https://api.shipaso.com",
    apiKey,
    appId: flags.app,
    storeUrl: flags["store-url"],
    statePath: flags.state ?? "postedge-state.json",
    outDir: flags.out ?? "postedge-out",
    postCmd: flags["post-cmd"] ?? null,
  };
}
