import { defineConfig } from "vitest/config";

// Phase 0 runs the PORTABLE core only (no React Native / jsdom needed): the API
// client, DTO types, and theme tokens are plain TS. Later phases that test RN
// components add jest-expo / @testing-library/react-native in their own config.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
