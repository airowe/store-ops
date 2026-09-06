import { describe, expect, it } from "vitest";
import { TOOLS } from "../../src/mcp/tools.ts";
import {
  EXPECTED_MCP_TOOL_COUNT,
  embedState,
  extractState,
  exitCode,
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
} from "./opsHeartbeat.mjs";

/**
 * #556 — the ops heartbeat measures and files; it never acts. These are the
 * pure halves: parsing what the runner fetched, deciding measured / failed /
 * unavailable, rendering the sticky-issue body, and spotting a flip.
 */

const TODAY = "2026-09-06";

describe("the expected MCP tool count is the set tools.spec.ts pins", () => {
  it("matches the live registry, so a drift there fails here too", () => {
    expect(EXPECTED_MCP_TOOL_COUNT).toBe(TOOLS.length);
  });
});

describe("mcpToolCheck", () => {
  it("measures the exact count and fails on any other number", () => {
    expect(mcpToolCheck(EXPECTED_MCP_TOOL_COUNT)).toMatchObject({ state: "measured", value: String(EXPECTED_MCP_TOOL_COUNT) });
    expect(mcpToolCheck(0)).toMatchObject({ state: "failed" });
    expect(mcpToolCheck(EXPECTED_MCP_TOOL_COUNT + 1)).toMatchObject({ state: "failed" });
  });
  it("a fetch that threw is failed with the reason, never a zero", () => {
    const r = mcpToolCheck(null, "ECONNRESET");
    expect(r.state).toBe("failed");
    expect(r.detail).toContain("ECONNRESET");
    expect(r.value).toBe("—");
  });
});

describe("workflowCheck", () => {
  it("success is measured, failure is failed, no run is unavailable with the reason", () => {
    expect(workflowCheck("deploy", { conclusion: "success", status: "completed", headSha: "abcdef0123" })).toMatchObject({
      state: "measured",
      value: "success @ abcdef0",
    });
    expect(workflowCheck("ci", { conclusion: "failure", status: "completed", headSha: "abcdef0123" })).toMatchObject({ state: "failed" });
    expect(workflowCheck("ci", null)).toMatchObject({ state: "unavailable", detail: expect.stringContaining("no runs") });
  });
  it("a run still in progress is measured as in progress, not failed", () => {
    expect(workflowCheck("deploy", { conclusion: "", status: "in_progress", headSha: "abcdef0123" })).toMatchObject({
      state: "measured",
      value: "in_progress @ abcdef0",
    });
  });
});

describe("prCheck", () => {
  const prs = [
    { number: 1, title: "green", statusCheckRollup: [{ conclusion: "SUCCESS" }] },
    { number: 2, title: "red", statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }] },
    { number: 3, title: "pending", statusCheckRollup: [{ conclusion: "" , status: "IN_PROGRESS" }] },
  ];
  it("names the PRs with a failing check and measures zero when none fail", () => {
    const r = prCheck(prs);
    expect(r.state).toBe("failed");
    expect(r.detail).toContain("#2");
    expect(r.detail).not.toContain("#1");
    expect(prCheck([prs[0]])).toMatchObject({ state: "measured", value: "0 of 1 red" });
  });
  it("no open PRs is a measurement, not an absence", () => {
    expect(prCheck([])).toMatchObject({ state: "measured", value: "0 of 0 red" });
  });
});

describe("parseAscVersions / parseAscBuilds", () => {
  it("reads the version string and store state, newest first as Apple returns them", () => {
    const json = { data: [{ attributes: { versionString: "0.1.1", appStoreState: "WAITING_FOR_REVIEW", createdDate: "2026-07-05" } }] };
    expect(parseAscVersions(json)).toEqual([{ version: "0.1.1", state: "WAITING_FOR_REVIEW", created: "2026-07-05" }]);
  });
  it("reads build number, processing state and upload date", () => {
    const json = { data: [{ attributes: { version: "202609051608", processingState: "VALID", uploadedDate: "2026-09-05T09:15:42-07:00" } }] };
    expect(parseAscBuilds(json)).toEqual([{ build: "202609051608", state: "VALID", uploaded: "2026-09-05T09:15:42-07:00" }]);
  });
  it("tolerates an empty or malformed payload by returning nothing, never a fake row", () => {
    expect(parseAscVersions({})).toEqual([]);
    expect(parseAscBuilds(null)).toEqual([]);
  });
});

describe("feedFreshness", () => {
  it("counts days since the newest entry regardless of array order", () => {
    const feed = { entries: [{ date: "2026-07-29" }, { date: "2026-09-05" }] };
    expect(feedFreshness(feed, TODAY)).toEqual({ latest: "2026-09-05", days: 1 });
  });
  it("an empty feed is unavailable, not zero days", () => {
    expect(feedFreshness({ entries: [] }, TODAY)).toBeNull();
  });
});

describe("renderReport", () => {
  const results = [
    measured("Production smoke", "6 of 6", "all public routes answered"),
    failed("Open PRs with red checks", "1 of 3 red", "#2 red"),
    unavailable("App Store version", "no ASC credentials on this runner"),
  ];
  const md = renderReport(results, { at: "2026-09-06T13:00:00Z", runUrl: "https://example/run/1" });
  it("is a table with one row per check and the three states spelled out", () => {
    expect(md).toContain("| Production smoke | measured | 6 of 6 |");
    expect(md).toContain("| Open PRs with red checks | **failed** | 1 of 3 red |");
    expect(md).toContain("| App Store version | unavailable | — |");
    expect(md).toContain("no ASC credentials");
  });
  it("says when and where it ran and that it only reads", () => {
    expect(md).toContain("2026-09-06T13:00:00Z");
    expect(md).toContain("https://example/run/1");
    expect(md).toMatch(/read-only/i);
  });
});

describe("embedState / extractState", () => {
  const results = [measured("a", "1"), failed("b", "—", "boom")];
  it("round-trips the results through an HTML comment in the issue body", () => {
    const body = embedState("# report", results);
    expect(body.startsWith("# report")).toBe(true);
    expect(extractState(body)).toEqual(results);
  });
  it("a body without state, or a hand-edited one, yields null rather than throwing", () => {
    expect(extractState("just text")).toBeNull();
    expect(extractState("<!-- ops-heartbeat:state {not json} -->")).toBeNull();
  });
});

describe("flips", () => {
  const prev = [measured("a", "1"), failed("b", "—", "old"), measured("c", "1")];
  const cur = [measured("a", "1"), failed("b", "—", "still"), failed("c", "—", "new")];
  it("reports only checks that are failed now and were not failed before", () => {
    expect(flips(prev, cur).map((r) => r.name)).toEqual(["c"]);
  });
  it("with no previous state every current failure is a flip, and unavailable never is", () => {
    expect(flips(null, [...cur, unavailable("d", "no key")]).map((r) => r.name)).toEqual(["b", "c"]);
  });
});

describe("exitCode", () => {
  it("is 1 when any check failed, 0 for measured and unavailable alone", () => {
    expect(exitCode([measured("a", "1"), unavailable("b", "no key")])).toBe(0);
    expect(exitCode([measured("a", "1"), failed("b", "—", "x")])).toBe(1);
  });
});
