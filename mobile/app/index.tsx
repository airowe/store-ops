/**
 * Placeholder entry screen (Phase 0). Confirms the app boots themed and can name
 * its job. Phase 1 replaces this with the auth guard that routes to the dashboard
 * `(app)` or the `(public)` login based on `GET /auth/me`.
 */
import React from "react";
import { Centered, AppText } from "../src/components/primitives.js";

export default function Index() {
  return (
    <Centered>
      <AppText kind="display">ShipASO</AppText>
      <AppText kind="dim">Honest ASO, on your phone.</AppText>
    </Centered>
  );
}
