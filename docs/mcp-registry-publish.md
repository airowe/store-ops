# Publishing the ShipASO MCP server to the MCP Registry

The manifest is `server.json` at the repo root, validated in CI by
`packages/docpaths/mcpManifest.test.mjs` against the version the server
announces and the URL the docs name. **Publishing is a public act and is a
human step** — nothing in this repo submits it.

## One-time

```bash
brew install mcp-publisher      # or the release tarball; see registry docs
```

## Each release

1. Bump `version` in `server.json` **and** `SERVER_INFO.version` in
   `cloud/src/mcp/server.ts` together — the guard fails if they differ.
2. Make sure the change is deployed: the registry requires a remote server to
   be reachable at its URL, and the manifest describes the public tier, which
   exists only after #529 is live.
3. From the repo root:

   ```bash
   mcp-publisher login github     # must be the `airowe` login — the name is io.github.airowe/shipaso
   mcp-publisher publish
   ```

## Why the name is `io.github.airowe/shipaso`

The registry verifies namespace ownership. `io.github.<login>/…` is proven by
logging in as that GitHub user; a `com.shipaso/…` name would need DNS or HTTP
domain verification instead. Switching later is a new listing, not a rename.

## What the listing claims

Only what is true today: a Streamable HTTP remote at `https://api.shipaso.com/mcp`,
an *optional* `Authorization` header (the public tier needs none), read-only
tools. No usage numbers — none are measured.
