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
 *   SHIPASO_API_KEY=shipaso_… shipaso-postedge \
 *     --app <appId> --store-url https://apps.apple.com/us/app/id… \
 *     [--post-cmd bird-post]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseCliArgs, runPostEdge } from "./postedge.mjs";

const execFileAsync = promisify(execFile);

async function main() {
  const opts = parseCliArgs(process.argv.slice(2), process.env);
  const post = opts.postCmd
    ? async (textPath, pngPath) => {
        await execFileAsync(opts.postCmd, [textPath, pngPath]);
      }
    : null;
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
      console.log(`[postedge] ${opts.appId}: posted. Evidence kept in ${out.outboxDir}`);
      break;
  }
}

main().catch((e) => {
  console.error(`[postedge] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
