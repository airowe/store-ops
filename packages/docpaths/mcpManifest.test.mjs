import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * `server.json` is the MCP Registry manifest for the hosted ShipASO server
 * (loop 2026-09-05, criterion 7). It is PREPARED here and PUBLISHED by a person
 * with `mcp-publisher` — publishing is a public act and stays a human step.
 *
 * What this guards is drift between the manifest and the server it describes:
 * the version the transport announces, the URL the docs tell people to add,
 * and the registry's own hard limits (name shape, 100-char description). A
 * manifest that lies about any of those is worse than none.
 */
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const manifest = JSON.parse(read("server.json"));

const MCP_URL = "https://api.shipaso.com/mcp";

test("the manifest carries the registry's three required fields within its limits", () => {
  assert.match(manifest.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/, "name must be <namespace>/<server>");
  assert.match(
    manifest.name,
    /^io\.github\.airowe\//,
    "the GitHub-authenticated namespace is io.github.<login>/ — publishing under anything else needs domain verification",
  );
  assert.ok(manifest.description.length <= 100, `description is ${manifest.description.length} chars; the registry caps it at 100`);
  assert.doesNotMatch(manifest.version, /^[\^~>=<]|latest|[x*]/, "version must be a specific version, not a range or 'latest'");
});

test("the version is the one the server actually announces", () => {
  const server = read("cloud/src/mcp/server.ts");
  const m = server.match(/SERVER_INFO\s*=\s*\{[^}]*version:\s*"([^"]+)"/);
  assert.ok(m, "could not find SERVER_INFO.version in cloud/src/mcp/server.ts");
  assert.equal(manifest.version, m[1], "server.json version must match SERVER_INFO.version — bump both together");
});

test("the remote is the URL every doc tells people to add", () => {
  assert.equal(manifest.remotes.length, 1);
  assert.equal(manifest.remotes[0].type, "streamable-http");
  assert.equal(manifest.remotes[0].url, MCP_URL);
  for (const doc of ["README.md", "skills/shipaso-mcp/SKILL.md"]) {
    assert.ok(read(doc).includes(MCP_URL), `${doc} no longer names ${MCP_URL} — the manifest and the docs disagree`);
  }
});

test("the Authorization header is declared optional — the public tier needs none", () => {
  const auth = (manifest.remotes[0].headers ?? []).find((h) => h.name === "Authorization");
  assert.ok(auth, "the remote should declare the optional Authorization header so clients know a key exists");
  assert.equal(auth.isRequired, false, "a required Authorization header would contradict the keyless front door");
  assert.equal(auth.isSecret, true);
});

test("the repository points at this repo", () => {
  assert.equal(manifest.repository.url, "https://github.com/airowe/store-ops");
  assert.equal(manifest.repository.source, "github");
});
