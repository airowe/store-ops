/**
 * The web surface's API client — built from the shared, transport-agnostic
 * `@shipaso/api` (PRD 01). Web auth is the session COOKIE, so we send
 * credentials and add no explicit token header. Native builds its own client
 * with a token strategy; the endpoint wrappers are identical.
 */
import { createClient } from "@shipaso/api";
import { API_BASE } from "./config.js";

export const client = createClient({
  baseUrl: API_BASE,
  credentials: "include",
});
