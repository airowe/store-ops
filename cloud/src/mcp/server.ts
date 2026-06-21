/**
 * ShipASO MCP server (#93) — serves the read-only/draft tool registry over MCP's
 * Streamable HTTP transport, mounted on the existing Worker at POST /mcp.
 *
 * We use the official @modelcontextprotocol/sdk's `McpServer` for protocol +
 * schema handling, paired with the WEB-STANDARD streamable-HTTP transport
 * (Fetch `Request` → `Response`) so it runs natively on Cloudflare Workers with
 * no Node http shim. The server is STATELESS: a fresh McpServer + transport per
 * request (the standard Workers pattern), so there's no cross-request session to
 * leak between users — auth is enforced by the Worker BEFORE we ever get here.
 *
 * Every registered tool is read-or-draft (see tools.ts). Nothing here can write
 * to the store; `propose_copy` returns a draft only.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { TOOLS, type ToolContext } from "./tools.js";

const SERVER_INFO = { name: "shipaso", version: "0.1.0" } as const;

const INSTRUCTIONS =
  "ShipASO exposes read-only ASO data and the proof surfaces as tools. Tools " +
  "audit, check ranks, find keyword gaps, and draft optimized copy — but NEVER " +
  "publish. Pushing a change to the App Store is a human-approved step inside " +
  "ShipASO; no tool here writes to the store. `propose_copy` returns a draft only.";

/**
 * Build an McpServer with every tool from the registry wired to its handler. The
 * caller context (authed user + env) is closed over per request. Tool results are
 * returned as JSON text content so any MCP client can render them.
 */
export function buildMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
  });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        // readOnlyHint tells a calling agent this tool has no side effects — it
        // mirrors the registry's compile-time `readOnly: true` guarantee.
        annotations: { title: tool.name, readOnlyHint: true, openWorldHint: true },
      },
      async (args: Record<string, unknown>) => {
        const data = await tool.handler(args ?? {}, ctx);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      },
    );
  }

  return server;
}

/**
 * Handle one MCP HTTP request. Stateless: a new server + transport per call. The
 * Worker has already authenticated the caller (handleApi → requireUser) and
 * passes the resolved user in `ctx`, so an unauthed request never reaches here.
 */
export async function handleMcp(req: Request, ctx: ToolContext): Promise<Response> {
  const server = buildMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    // sessionIdGenerator omitted → stateless mode (no server-held session).
    enableJsonResponse: true, // simple request/response (no SSE stream needed)
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
