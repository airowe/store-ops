/**
 * Minimal static server with SPA fallback for the built redesign (`dist/`).
 * Serves real assets; falls back to index.html for any owned client-side route
 * (/apps/:id, /runs/:id, …) so a hard navigation or deep-link resolves to the
 * SPA — mirroring the edge worker's behavior in prod. E2E-only; no API here
 * (the specs intercept api.shipaso.com via Playwright routing).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const PORT = Number(process.env.PORT || 8794);
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json",
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const safe = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  const hasExt = extname(safe) !== "";
  const file = hasExt ? join(DIST, safe) : join(DIST, "index.html"); // SPA fallback
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    // unknown asset → still fall back to the SPA shell (never 404 a route)
    try {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(await readFile(join(DIST, "index.html")));
    } catch {
      res.writeHead(500);
      res.end("no dist — run `npm run build` first");
    }
  }
}).listen(PORT, () => console.log(`e2e static server on http://127.0.0.1:${PORT}`));
