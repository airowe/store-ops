import { describe, expect, it } from "vitest";
import { branchName, prTitle, prBody, treeEntries, openMetadataPr } from "./githubPr.js";
import type { BundleFile } from "./fastlane.js";

describe("branchName", () => {
  it("is a deterministic, valid git ref from the run id", () => {
    const b = branchName("7e0e2f08-be41-467d");
    expect(b).toMatch(/^shipaso\/aso-7e0e2f08-be41-467d$/);
  });

  it("strips characters that aren't ref-safe", () => {
    expect(branchName("a b/c~^:?*[")).not.toMatch(/[ ~^:?*[\\]/);
  });
});

describe("prTitle / prBody", () => {
  it("title names the app", () => {
    expect(prTitle("Calm")).toContain("Calm");
    expect(prTitle("Calm").toLowerCase()).toContain("aso");
  });

  it("body explains what to do (review + CI runs deliver/supply) and lists the files", () => {
    const body = prBody("Calm", [
      { path: "fastlane/metadata/en-US/name.txt", content: "Calm" },
      { path: "fastlane/metadata/en-US/keywords.txt", content: "sleep,calm" },
    ]);
    expect(body.toLowerCase()).toContain("deliver");
    expect(body.toLowerCase()).toContain("supply");
    expect(body).toContain("fastlane/metadata/en-US/name.txt");
    // doesn't dump full file CONTENT into the PR body (just the paths)
    expect(body).not.toContain("sleep,calm");
  });
});

describe("treeEntries — fastlane files → Git Data API tree", () => {
  const files: BundleFile[] = [
    { path: "fastlane/metadata/en-US/name.txt", content: "Calm" },
    { path: "fastlane/metadata/SHIPASO_README.md", content: "# readme" },
  ];

  it("maps each file to a blob tree entry (mode 100644, type blob)", () => {
    const entries = treeEntries(files);
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.mode).toBe("100644");
      expect(e.type).toBe("blob");
      expect(typeof e.path).toBe("string");
      expect(typeof e.content).toBe("string");
    }
  });

  it("preserves path + content verbatim", () => {
    const e = treeEntries(files)[0]!;
    expect(e.path).toBe("fastlane/metadata/en-US/name.txt");
    expect(e.content).toBe("Calm");
  });

  it("returns an empty tree for no files", () => {
    expect(treeEntries([])).toEqual([]);
  });
});

describe("openMetadataPr — Git Data API orchestration", () => {
  function ghMock(over: Record<string, (init?: RequestInit) => Response> = {}) {
    const calls: { url: string; method: string }[] = [];
    const j = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fetchFn = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      for (const key of Object.keys(over)) if (url.endsWith(key) || url.includes(key)) return over[key]!(init);
      if (url.match(/\/repos\/[^/]+\/[^/]+$/)) return j({ default_branch: "main" });
      if (url.includes("/git/ref/heads/")) return j({ object: { sha: "BASESHA" } });
      if (url.includes("/git/commits/BASESHA")) return j({ tree: { sha: "BASETREE" } });
      if (url.endsWith("/git/trees")) return j({ sha: "NEWTREE" });
      if (url.endsWith("/git/commits")) return j({ sha: "NEWCOMMIT" });
      if (url.endsWith("/git/refs")) return j({ ref: "refs/heads/x" }, 201);
      if (url.endsWith("/pulls")) return j({ html_url: "https://github.com/o/r/pull/7", number: 7 }, 201);
      return j({}, 404);
    };
    return { fetchFn, calls };
  }

  const files = [{ path: "fastlane/metadata/en-US/name.txt", content: "Calm" }];

  it("walks ref → commit → tree → commit → branch → PR and returns the PR url", async () => {
    const { fetchFn, calls } = ghMock();
    const r = await openMetadataPr(fetchFn, { token: "T", repo: "o/r", runId: "run1", appName: "Calm", files });
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://github.com/o/r/pull/7");
    expect(r.number).toBe(7);
    expect(r.branch).toBe("shipaso/aso-run1");
    // the PR creation was a POST to /pulls
    expect(calls.some((c) => c.url.endsWith("/pulls") && c.method === "POST")).toBe(true);
  });

  it("throws GithubAppError (token-free) when a step fails", async () => {
    const { fetchFn } = ghMock({
      "/pulls": () => new Response(JSON.stringify({ message: "validation failed" }), { status: 422 }),
    });
    await expect(
      openMetadataPr(fetchFn, { token: "SECRET_TOKEN", repo: "o/r", runId: "r", appName: "X", files }),
    ).rejects.toThrow(/422/);
    await openMetadataPr(fetchFn, { token: "SECRET_TOKEN", repo: "o/r", runId: "r", appName: "X", files }).catch(
      (e: Error) => expect(e.message).not.toContain("SECRET_TOKEN"),
    );
  });

  it("rejects an invalid repo", async () => {
    const { fetchFn } = ghMock();
    await expect(
      openMetadataPr(fetchFn, { token: "T", repo: "noslash", runId: "r", appName: "X", files }),
    ).rejects.toThrow(/owner\/name/);
  });
});
