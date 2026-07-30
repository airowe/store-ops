/*
 * config.js — dashboard runtime config (no build step; edit & redeploy).
 *
 * API_BASE: the deployed store-ops Worker URL (the REST API the dashboard calls).
 *   Leave EMPTY to run the dashboard fully clickable on the in-browser demo
 *   backend (mock.js) — useful for Pages-only previews before the Worker exists.
 *   Set it to your Worker once deployed, e.g.:
 *     window.STORE_OPS = { API_BASE: "https://store-ops.<your-subdomain>.workers.dev" };
 *
 * The dashboard auto-detects: if API_BASE is set but the Worker is unreachable,
 * it falls back to the demo backend for the session (and flips the header pill).
 */
window.STORE_OPS = {
  API_BASE: "https://api.shipaso.com",
};
