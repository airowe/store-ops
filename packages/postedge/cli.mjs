#!/usr/bin/env node
/**
 * shipaso-postedge — the cron/agent entry for the #BuildInPublic posting edge.
 *
 * Run it after a sweep (or on a schedule). With no --post-cmd it PREPARES: the
 * ready-to-post text + rasterized proof card land in the outbox and nothing is
 * sent — connecting the X account means supplying --post-cmd (the `bird`
 * skill's poster), which is invoked as `<cmd> <post.txt> <card.png>`. Only a
 * successful post consumes the win.
 *
 * With --journal <dir> (point it at docs/landing/journey), a POSTED win is
 * also appended to the public /journey ledger with its proof card. If the post
 * command prints the created post's URL (`url=https://x.com/…`, or a bare
 * https URL) on stdout, the ledger entry links to it; no URL printed → no link.
 *
 * No X API subscription? The manual-paste loop: run with no --post-cmd (the
 * outbox gets post.txt + card.png), paste them into X yourself, then run again
 * with --mark-posted <the post's URL>. That records the win exactly as an
 * automated post would — consumed (never re-posted), journaled with your URL —
 * without this tool ever touching X.
 *
 *   SHIPASO_API_KEY=shipaso_… shipaso-postedge \
 *     --app <appId> --store-url https://apps.apple.com/us/app/id… \
 *     [--post-cmd bird-post | --mark-posted https://x.com/…/status/…] \
 *     [--journal docs/landing/journey]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseCliArgs, runPostEdge } from "./postedge.mjs";

const execFileAsync = promisify(execFile);

async function main() {
  const opts = parseCliArgs(process.argv.slice(2), process.env);
  let post = null;
  if (opts.postCmd) {
    post = async (textPath, pngPath) => {
      // stdout rides back so runPostEdge can pick up a `url=…` line for the
      // journal's "View the post" link.
      const { stdout } = await execFileAsync(opts.postCmd, [textPath, pngPath]);
      return stdout;
    };
  } else if (opts.markPostedUrl) {
    // The human already posted (manual-paste loop) — this "post" only claims
    // the URL, so state + journal record the win exactly like an automated post.
    post = async () => `url=${opts.markPostedUrl}`;
  }
  const out = await runPostEdge(opts, post ? { post } : {});

  switch (out.status) {
    case "no-win":
      console.log(`[postedge] ${opts.appId}: no genuine win to post — posting nothing.`);
      break;
    case "duplicate":
      console.log(`[postedge] ${opts.appId}: current win already posted — skipping.`);
      break;
    case "prepared":
      console.log(
        `[postedge] ${opts.appId}: post prepared (not sent — no --post-cmd connected):\n` +
          `  ${out.outboxDir}/post.txt + card.png`,
      );
      break;
    case "posted":
      console.log(
        `[postedge] ${opts.appId}: ${opts.markPostedUrl ? "win recorded as posted (by you)" : "posted"}. ` +
          `Evidence kept in ${out.outboxDir}` +
          (out.journaled ? ` and journaled to ${opts.journalDir}` : ""),
      );
      break;
  }
}

main().catch((e) => {
  console.error(`[postedge] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
