/**
 * Ops heartbeat (#556) — the runner. READ-ONLY.
 *
 * Measures the things a person was checking by hand and writes one report:
 * production smoke, the anonymous MCP tool count, the latest deploy run
 * on main, open PRs with red checks, the App Store version and TestFlight
 * build states (when ASC credentials are present), and journey-feed
 * freshness. It never merges, deploys, attaches, submits, or posts. The
 * workflow that schedules it upserts the report onto a sticky issue and opens
 * one issue per check that flipped to failed.
 *
 * Run:  node scripts/ops-heartbeat.mjs --out <dir> [--prev <file-with-previous-issue-body>]
 *   OPS_APP_ID   ASC app id to watch            (default 6787632160, ShipASO)
 *   OPS_RUN_URL  link to this run for the report (default "local")
 *   API_BASE     API origin for smoke + MCP      (default https://api.shipaso.com)
 *
 * Writes <out>/report.md (sticky-issue body with embedded state), <out>/results.json,
 * and <out>/flips.json. Exit 1 when any check failed, 0 otherwise — unavailable
 * is not a failure, and is not a pass either.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  embedState,
  exitCode,
  extractState,
  failed,
  feedFreshness,
  flips,
  mcpToolCheck,
  measured,
  parseAscBuilds,
  parseAscVersions,
  prCheck,
  renderReport,
  unavailable,
  workflowCheck,
} from "./lib/opsHeartbeat.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const API = (process.env.API_BASE ?? "https://api.shipaso.com").replace(/\/$/, "");
const APP_ID = process.env.OPS_APP_ID ?? "6787632160";
const RUN_URL = process.env.OPS_RUN_URL ?? "local";

const args = process.argv.slice(2);
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const outDir = opt("--out") ?? path.join(HERE, "..", ".ops-heartbeat");
const prevFile = opt("--prev");

const sh = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();

const results = [];

// 1. Production smoke — the existing script, as a subprocess so its exit code is the verdict.
{
  const name = "Production smoke";
  const r = spawnSync(process.execPath, [path.join(HERE, "smoke.mjs")], { encoding: "utf8", env: process.env });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // per-check lines are indented; the summary line ("✓ all … passed") is not
  const passed = (out.match(/^[ \t]+✓ /gm) ?? []).length;
  const total = passed + (out.match(/^[ \t]+✗ /gm) ?? []).length;
  if (r.status === 0) results.push(measured(name, `${passed} of ${total}`, "all public routes answered"));
  else results.push(failed(name, `${passed} of ${total}`, out.split("\n").filter((l) => l.includes("✗")).join("; ") || `exit ${r.status}`));
}

// 2. Anonymous MCP tool count — no key, the front door #529 opened.
{
  try {
    const res = await fetch(`${API}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const text = await res.text();
    const json = JSON.parse(text.replace(/^(event:.*\n)?data: /m, "").split("\n").find((l) => l.startsWith("{")) ?? text);
    results.push(mcpToolCheck(Array.isArray(json?.result?.tools) ? json.result.tools.length : null, `HTTP ${res.status}`));
  } catch (e) {
    results.push(mcpToolCheck(null, e instanceof Error ? e.message : String(e)));
  }
}

// 3. Latest deploy run on main. (ci.yml runs on pull requests only; deploy.yml
//    repeats the same gate on every push to main and then deploys, so it is
//    the one run that says whether main is green AND live.)
for (const wf of ["deploy.yml"]) {
  try {
    const json = sh("gh", ["run", "list", "--workflow", wf, "--branch", "main", "--limit", "1", "--json", "conclusion,status,headSha,url"], { cwd: REPO });
    results.push(workflowCheck(wf.replace(".yml", ""), JSON.parse(json)[0] ?? null));
  } catch (e) {
    results.push(unavailable(`Latest ${wf.replace(".yml", "")} run on main`, `gh run list failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`));
  }
}

// 4. Open PRs with a failing check.
try {
  const json = sh("gh", ["pr", "list", "--state", "open", "--json", "number,title,statusCheckRollup"], { cwd: REPO });
  results.push(prCheck(JSON.parse(json)));
} catch (e) {
  results.push(unavailable("Open PRs with red checks", `gh pr list failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`));
}

// 5–6. App Store version + TestFlight builds, only when asc can authenticate here.
{
  let ascOk = false;
  let why = "asc not installed";
  try {
    const doctor = spawnSync("asc", ["doctor"], { encoding: "utf8" });
    ascOk = doctor.status === 0 && /\[OK\].*complete/.test(doctor.stdout ?? "");
    why = ascOk ? "" : "no ASC credentials on this runner (asc doctor found no complete profile)";
  } catch {
    /* not installed */
  }
  if (!ascOk) {
    results.push(unavailable("App Store version state", why));
    results.push(unavailable("Newest TestFlight build", why));
  } else {
    try {
      const versions = parseAscVersions(JSON.parse(sh("asc", ["versions", "list", "--app", APP_ID, "--output", "json"])));
      const v = versions[0];
      if (!v) results.push(unavailable("App Store version state", `asc returned no versions for ${APP_ID}`));
      else if (/REJECTED|DEVELOPER_REJECTED|INVALID_BINARY/.test(v.state)) results.push(failed("App Store version state", `${v.version} ${v.state}`, "needs a person"));
      else results.push(measured("App Store version state", `${v.version} ${v.state}`));
    } catch (e) {
      results.push(unavailable("App Store version state", `asc versions list failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`));
    }
    try {
      const builds = parseAscBuilds(JSON.parse(sh("asc", ["builds", "list", "--app", APP_ID, "--limit", "1", "--output", "json"])));
      const b = builds[0];
      if (!b) results.push(unavailable("Newest TestFlight build", `asc returned no builds for ${APP_ID}`));
      else if (b.state !== "VALID") results.push(failed("Newest TestFlight build", `${b.build} ${b.state}`, `uploaded ${b.uploaded}`));
      else results.push(measured("Newest TestFlight build", `${b.build} ${b.state}`, `uploaded ${b.uploaded}`));
    } catch (e) {
      results.push(unavailable("Newest TestFlight build", `asc builds list failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`));
    }
  }
}

// 7. Journey feed freshness — the distribution loop's pulse.
{
  const name = "Journey feed freshness";
  try {
    const feed = JSON.parse(fs.readFileSync(path.join(REPO, "docs/landing/journey/feed.json"), "utf8"));
    const f = feedFreshness(feed, new Date().toISOString().slice(0, 10));
    if (!f) results.push(unavailable(name, "feed has no dated entries"));
    else results.push(measured(name, `${f.days} day${f.days === 1 ? "" : "s"} since ${f.latest}`));
  } catch (e) {
    results.push(unavailable(name, `could not read feed.json: ${e instanceof Error ? e.message : e}`));
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const prev = prevFile && fs.existsSync(prevFile) ? extractState(fs.readFileSync(prevFile, "utf8")) : null;
const flipped = flips(prev, results);
const report = renderReport(results, { at: new Date().toISOString(), runUrl: RUN_URL });

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "report.md"), embedState(report, results));
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(outDir, "flips.json"), JSON.stringify(flipped, null, 2));

process.stdout.write(report);
if (flipped.length) process.stdout.write(`\nFlipped to failed since last run: ${flipped.map((r) => r.name).join(", ")}\n`);
process.exit(exitCode(results));
