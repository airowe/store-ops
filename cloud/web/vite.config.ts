/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/** Consume the shared spine by alias (workspace wiring lands with the monorepo). */
const alias = {
  "@shipaso/api": fileURLToPath(new URL("../../packages/api/index.ts", import.meta.url)),
  "@shipaso/honesty": fileURLToPath(new URL("../../packages/honesty/index.mjs", import.meta.url)),
  "@shipaso/tokens/css": fileURLToPath(new URL("../../packages/tokens/generated/tokens.css", import.meta.url)),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  // packages/ lives above the app root; allow Vite to read the spine sources.
  server: {
    fs: { allow: [".", "../../packages"] },
    // Local dev only: proxy the API through this origin so the session cookie is
    // SAME-SITE. Pointing the app at a separate Worker origin (127.0.0.1:8787)
    // makes every auth request cross-site, and the browser drops the cookie —
    // which is why the authed flow could never be exercised locally. Set
    // VITE_API_BASE="" (or leave it unset) to route through this proxy.
    proxy: {
      // Every Worker route the spine calls. A regex rather than a list so a new
      // endpoint doesn't silently 404 through the proxy.
      "^/(auth|apps|runs|preview|account|agent|billing|proof|github|resolve|rejection-assistant)(/|$)": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/vitest.setup.ts"],
    // Only this app's TS/TSX tests. The spine's node:test *.test.mjs (reachable
    // via the @shipaso alias) are run by the CI `spine` job, not vitest.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
