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
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
 * @returns {Promise<{ text: string, hashtags: string[], cardSvg: string,
 *   win?: { keyword: string, current: number, previous: number | null,
 *           delta: number | null, direction: string } } | null>}
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
 * The X post URL, when the post command reported one: either a bare https URL
 * or a `url=<https…>` line anywhere in its output. Anything else → null —
 * a link is evidence, and evidence is never invented.
 */
function extractPostUrl(postResult) {
  if (typeof postResult !== "string") return null;
  const m = postResult.match(/(?:^|\s|=)(https:\/\/\S+)/);
  return m ? m[1] : null;
}

/**
 * Append the posted win to the public /journey ledger: the entry (measured
 * numbers from the emitter's structured `win`, the exact posted text as body)
 * plus the proof card copied to cards/. Idempotent by the win's card filename.
 * A malformed feed.json throws — the ledger is never clobbered.
 */
async function journalWin(journalDir, { win, text, key, pngPath, postUrl, date }) {
  let feed = { version: 1, entries: [] };
  const feedPath = join(journalDir, "feed.json");
  try {
    feed = JSON.parse(await readFile(feedPath, "utf8"));
  } catch (e) {
    if (e?.code !== "ENOENT") {
      throw new Error(`journal feed.json is unreadable or malformed — refusing to clobber it: ${e}`);
    }
  }
  const card = `cards/${key.slice(0, 12)}.png`;
  if (feed.entries.some((e) => e.card === card)) return; // this win is already on the ledger

  await mkdir(join(journalDir, "cards"), { recursive: true });
  await copyFile(pngPath, join(journalDir, card));
  const move =
    win.direction === "new"
      ? `debuted at #${win.current}`
      : `climbed #${win.previous} → #${win.current}`;
  feed.entries.push({
    date,
    kind: "win",
    title: `“${win.keyword}” ${move}`,
    body: text,
    ...(postUrl ? { links: { x: postUrl } } : {}),
    card,
    numbers: {
      keyword: win.keyword,
      ...(win.previous === null ? {} : { from: win.previous }),
      to: win.current,
    },
  });
  await writeFile(feedPath, `${JSON.stringify(feed, null, 2)}\n`, "utf8");
}

/**
 * One posting pass for one app. Returns the outcome:
 *   { status: "no-win" }                            — server says nothing to brag about
 *   { status: "duplicate" }                         — this exact win already posted
 *   { status: "prepared", outboxDir, text }         — outbox written; no post command connected
 *   { status: "posted", outboxDir, text, journaled} — bird ran; win recorded in state
 *
 * With `journalDir` set, a POSTED win (and only a posted one) is also appended
 * to the /journey ledger — but only when the emitter supplied the structured
 * `win` (measured numbers are journaled, never parsed back out of prose).
 *
 * @param {{ base: string, apiKey: string, appId: string, storeUrl: string,
 *           outDir: string, statePath: string, journalDir?: string | null }} opts
 * @param {{ fetchImpl?: typeof fetch,
 *           post?: (textPath: string, pngPath: string) => Promise<unknown>,
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
  const postResult = await post(textPath, pngPath);
  // The post HAPPENED — record that fact before journaling, so a journal
  // failure can never cause the same win to be posted to X twice.
  state.apps[opts.appId] = { key, text: found.text, postedAt: now().toISOString() };
  await writeFile(opts.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  let journaled = false;
  if (opts.journalDir && found.win) {
    await journalWin(opts.journalDir, {
      win: found.win,
      text: found.text,
      key,
      pngPath,
      postUrl: extractPostUrl(postResult),
      date: now().toISOString().slice(0, 10),
    });
    journaled = true;
  }
  return { status: "posted", outboxDir, text: found.text, journaled };
}

const USAGE =
  "usage: shipaso-postedge --app <appId> --store-url <https://…> " +
  "[--state <file>] [--out <dir>] [--post-cmd <cmd>] [--journal <dir>]   (SHIPASO_API_KEY required in env)";

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
    journalDir: flags.journal ?? null,
  };
}
