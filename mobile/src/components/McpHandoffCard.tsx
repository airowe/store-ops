/**
 * McpHandoffCard (#93) — "Run it from your AI agent." A read-only connection
 * recipe: the exact `claude mcp add` command pointing at this deployment's MCP
 * endpoint, with a Bearer-key placeholder the user fills from a key minted in
 * the Agent access card above.
 *
 * Honest: draft-only — an agent connected this way can audit + propose but can
 * NEVER push; approving and shipping stay a human action here. No secret is
 * shown (the command carries a placeholder, not a real key).
 */
import { View } from "react-native";
import { apiBase } from "../lib/config.js";
import { palette, radius, spacing } from "../theme/index.js";
import { AppText, Card } from "./primitives.js";

export function McpHandoffCard() {
  const mcpUrl = `${apiBase().replace(/\/+$/, "")}/mcp`;
  const command =
    `claude mcp add shipaso --transport http ${mcpUrl} \\\n` +
    `  --header "Authorization: Bearer <your shipaso_ key>"`;

  return (
    <Card>
      <View testID="mcp-handoff" style={{ gap: spacing.xs }}>
        <AppText kind="lead">Run it from your AI agent</AppText>
        <AppText kind="micro">
          Connect the ShipASO MCP and your agent can drive the audit → propose loop. Draft-only: the
          agent can’t push — approving + shipping stay here. Generate a key in Agent access above.
        </AppText>
        <View
          style={{ borderColor: palette.line, borderWidth: 1, borderRadius: radius.base, padding: spacing.sm, marginTop: spacing.xs }}
        >
          <AppText kind="mono" testID="mcp-command" selectable>
            {command}
          </AppText>
        </View>
      </View>
    </Card>
  );
}
