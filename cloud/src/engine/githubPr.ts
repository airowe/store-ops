import type { BundleFile } from "./fastlane.js";
import { GithubAppError, githubDetail } from "./githubApp.js";

/**
 * Open a PR that writes the Fastlane metadata tree into the user's repo (#8).
 *
 * Pure builders (branch name, PR title/body, tree entries) + the Git Data API
 * orchestration (get base ref → create blobs/tree → commit → branch → PR). The
 * installation token is the only credential and never appears in an error.
 */

const GH = "https://api.github.com";

/** A git-ref-safe branch derived from the run id (deterministic → idempotent-ish). */
export function branchName(runId: string): string {
  const safe = runId.replace(/[^A-Za-z0-9._-]/g, "");
  return `shipaso/aso-${safe}`;
}

export function prTitle(appName: string): string {
  return `ASO metadata update for ${appName}`;
}

export function prBody(appName: string, files: BundleFile[]): string {
  const list = files.map((f) => `- \`${f.path}\``).join("\n");
  return [
    `ShipASO prepared an ASO metadata update for **${appName}** and wrote it into the`,
    "Fastlane `fastlane/metadata/` tree.",
    "",
    "**Review the diff, then merge.** Your CI (which already holds your store",
    "credentials) runs the push:",
    "",
    "```bash",
    "fastlane deliver --skip_binary_upload --skip_screenshots --force   # App Store",
    "```",
    "",
    "ShipASO never holds your store credentials — the credentialed step stays in",
    "your pipeline. The App Store push is the one irreversible step; review first.",
    "",
    "Files in this change:",
    list,
    "",
  ].join("\n");
}

export type TreeEntry = { path: string; mode: "100644"; type: "blob"; content: string };

export function treeEntries(files: BundleFile[]): TreeEntry[] {
  return files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content }));
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type OpenPrResult = { ok: true; url: string; number: number; branch: string };

/**
 * Create a branch off the repo's default branch, commit the fastlane tree, and
 * open a PR. `repo` is "owner/name". `token` is a short-lived installation token.
 */
export async function openMetadataPr(
  fetchFn: FetchLike,
  opts: { token: string; repo: string; runId: string; appName: string; files: BundleFile[] },
): Promise<OpenPrResult> {
  if (!opts.files.length) throw new GithubAppError("No metadata files to commit.");
  const [owner, name] = opts.repo.split("/");
  if (!owner || !name) throw new GithubAppError(`Invalid repo "${opts.repo}" (expected owner/name).`);

  const h = {
    authorization: `Bearer ${opts.token}`,
    accept: "application/vnd.github+json",
    "user-agent": "ShipASO",
    "content-type": "application/json",
  };
  const base = `${GH}/repos/${owner}/${name}`;
  const api = async (path: string, init?: RequestInit) => {
    const res = await fetchFn(`${base}${path}`, { ...init, headers: h });
    if (!res.ok) throw new GithubAppError(`GitHub ${path} failed (${res.status})${await githubDetail(res)}`);
    return res.json();
  };

  // 1. default branch + its head sha
  const repoInfo = (await api("")) as { default_branch?: string };
  const defaultBranch = repoInfo.default_branch || "main";
  const ref = (await api(`/git/ref/heads/${defaultBranch}`)) as { object?: { sha?: string } };
  const baseSha = ref.object?.sha;
  if (!baseSha) throw new GithubAppError("Couldn't resolve the default branch head.");

  // 2. base commit → its tree sha
  const baseCommit = (await api(`/git/commits/${baseSha}`)) as { tree?: { sha?: string } };
  const baseTreeSha = baseCommit.tree?.sha;

  // 3. create a tree with the fastlane files, based on the base tree
  const tree = (await api("/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries(opts.files) }),
  })) as { sha?: string };
  if (!tree.sha) throw new GithubAppError("GitHub did not return a tree sha.");

  // 4. commit
  const commit = (await api("/git/commits", {
    method: "POST",
    body: JSON.stringify({
      message: prTitle(opts.appName),
      tree: tree.sha,
      parents: [baseSha],
    }),
  })) as { sha?: string };
  if (!commit.sha) throw new GithubAppError("GitHub did not return a commit sha.");

  // 5. branch pointing at the commit
  const branch = branchName(opts.runId);
  await api("/git/refs", {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
  });

  // 6. open the PR
  const pr = (await api("/pulls", {
    method: "POST",
    body: JSON.stringify({
      title: prTitle(opts.appName),
      head: branch,
      base: defaultBranch,
      body: prBody(opts.appName, opts.files),
    }),
  })) as { html_url?: string; number?: number };
  if (!pr.html_url || pr.number === undefined) {
    throw new GithubAppError("GitHub did not return the opened PR.");
  }
  return { ok: true, url: pr.html_url, number: pr.number, branch };
}
