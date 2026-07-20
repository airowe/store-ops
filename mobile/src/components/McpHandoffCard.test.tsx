/**
 * McpHandoffCard (#93) — the honesty invariants:
 *   • it's a read-only connection recipe: the exact `claude mcp add` command with
 *     the real MCP endpoint and a Bearer-key placeholder;
 *   • draft-only framing: the agent can audit + propose but never push.
 */
import { render, screen } from "@testing-library/react-native";
import { McpHandoffCard } from "./McpHandoffCard.js";

// apiBase() reads expo-constants; the config module has a default fallback, so
// the card renders a concrete https URL under test.
describe("McpHandoffCard", () => {
  it("shows the MCP connect command with the /mcp endpoint and a Bearer-key placeholder", () => {
    render(<McpHandoffCard />);
    const cmd = screen.getByTestId("mcp-command");
    expect(cmd).toHaveTextContent(/claude mcp add shipaso/);
    expect(cmd).toHaveTextContent(/\/mcp/);
    expect(cmd).toHaveTextContent(/Authorization: Bearer/);
    // the placeholder points at the key you mint above — never a real secret
    expect(cmd).toHaveTextContent(/shipaso_ key|<your/);
  });

  it("frames it as draft-only — the agent can't push", () => {
    render(<McpHandoffCard />);
    expect(screen.getByTestId("mcp-handoff")).toHaveTextContent(/can[’']?t push|never push|approving/i);
  });
});
