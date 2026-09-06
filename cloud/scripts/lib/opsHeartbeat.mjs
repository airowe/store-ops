/**
 * Ops heartbeat (#556) — the pure half.
 *
 * The runner (`scripts/ops-heartbeat.mjs`) fetches; this module decides and
 * renders. Every check lands in one of three states, and the report shows the
 * state rather than a number standing in for one:
 *
 *   measured     — the check ran and the value is what it saw
 *   failed       — the check ran and what it saw is wrong
 *   unavailable  — the check could not run here, with the reason
 *
 * A check that cannot run never reports `0` or "ok". A flip is a check that is
 * failed now and was not failed on the previous run; unavailable is never a
 * flip, because nothing was measured.
 */

/** The launch tool set `src/mcp/tools.spec.ts` pins; the spec here asserts they agree. */
export const EXPECTED_MCP_TOOL_COUNT = 12;

export const measured = (name, value, detail = "") => ({ name, state: "measured", value: String(value), detail });
export const failed = (name, value, detail) => ({ name, state: "failed", value: String(value), detail });
export const unavailable = (name, reason) => ({ name, state: "unavailable", value: "—", detail: reason });

export function mcpToolCheck(count, error = "") {
  const name = "Anonymous MCP tool count";
  if (count === null || count === undefined) return failed(name, "—", `tools/list did not answer: ${error}`);
  if (count === EXPECTED_MCP_TOOL_COUNT) return measured(name, count, "matches tools.spec.ts");
  return failed(name, count, `expected ${EXPECTED_MCP_TOOL_COUNT} (tools.spec.ts), got ${count}`);
}

export function workflowCheck(workflow, run) {
  const name = `Latest ${workflow} run on main`;
  if (!run) return unavailable(name, `no runs of ${workflow} on main`);
  const sha = String(run.headSha ?? "").slice(0, 7);
  if (run.status !== "completed") return measured(name, `${run.status} @ ${sha}`, run.url ?? "");
  if (run.conclusion === "success") return measured(name, `success @ ${sha}`, run.url ?? "");
  return failed(name, `${run.conclusion} @ ${sha}`, run.url ?? "");
}

export function prCheck(prs) {
  const name = "Open PRs with red checks";
  const red = prs.filter((p) => (p.statusCheckRollup ?? []).some((c) => c.conclusion === "FAILURE"));
  const value = `${red.length} of ${prs.length} red`;
  if (red.length === 0) return measured(name, value);
  return failed(name, value, red.map((p) => `#${p.number} ${p.title}`).join("; "));
}

export function parseAscVersions(json) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows
    .map((r) => r?.attributes ?? {})
    .filter((a) => typeof a.versionString === "string")
    .map((a) => ({ version: a.versionString, state: a.appStoreState ?? "", created: a.createdDate ?? "" }));
}

export function parseAscBuilds(json) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows
    .map((r) => r?.attributes ?? {})
    .filter((a) => typeof a.version === "string")
    .map((a) => ({ build: a.version, state: a.processingState ?? "", uploaded: a.uploadedDate ?? "" }));
}

export function feedFreshness(feed, today) {
  const dates = (feed?.entries ?? []).map((e) => e?.date).filter((d) => typeof d === "string");
  if (dates.length === 0) return null;
  const latest = dates.sort().at(-1);
  const days = Math.round((Date.parse(today) - Date.parse(latest)) / 86_400_000);
  return { latest, days };
}

const STATE_TAG = "ops-heartbeat:state";

export function renderReport(results, { at, runUrl }) {
  const lines = [
    "## Ops heartbeat",
    "",
    `Read-only. Measured at ${at} by [this run](${runUrl}). Nothing here acts; it files.`,
    "",
    "| Check | State | Value | Detail |",
    "|---|---|---|---|",
  ];
  for (const r of results) {
    const state = r.state === "failed" ? "**failed**" : r.state;
    lines.push(`| ${r.name} | ${state} | ${r.value} | ${r.detail.replace(/\|/g, "\\|")} |`);
  }
  lines.push("", "A check reads *unavailable* when it could not run on this runner; that is not a pass.");
  return lines.join("\n") + "\n";
}

export function embedState(report, results) {
  return `${report}\n<!-- ${STATE_TAG} ${JSON.stringify(results)} -->\n`;
}

export function extractState(body) {
  const m = new RegExp(`<!-- ${STATE_TAG} (.*?) -->`, "s").exec(body ?? "");
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function flips(prev, cur) {
  const wasFailed = new Set((prev ?? []).filter((r) => r.state === "failed").map((r) => r.name));
  return cur.filter((r) => r.state === "failed" && !wasFailed.has(r.name));
}

export function exitCode(results) {
  return results.some((r) => r.state === "failed") ? 1 : 0;
}
