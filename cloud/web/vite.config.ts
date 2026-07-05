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
  server: { fs: { allow: [".", "../../packages"] } },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/vitest.setup.ts"],
  },
});
