/**
 * ApiKeysCard (#93) — the honesty + security invariants:
 *   • the raw key is shown EXACTLY ONCE, right after minting (we store only its
 *     hash) — the list never shows a raw key, only the non-secret prefix;
 *   • revoke is immediate and independent of the login session;
 *   • generate is gated on a non-empty label.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ApiClient } from "../api/client.js";
import type { ApiKeyCreated, ApiKeyMeta } from "../types/api.js";
import { ApiKeysCard } from "./ApiKeysCard.js";

function fakeClient(initial: ApiKeyMeta[]): { client: ApiClient; events: string[] } {
  let keys = [...initial];
  const events: string[] = [];
  const respond = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    events.push(`${method} ${path}`);
    if (path === "/account/api-keys" && method === "GET") return { keys };
    if (path === "/account/api-keys" && method === "POST") {
      const label = (body as { label: string }).label;
      const created: ApiKeyCreated = {
        id: "k-new",
        label,
        prefix: "shipaso_1a2b3c4d…",
        createdAt: "2026-07-20T00:00:00Z",
        lastUsedAt: null,
        key: "shipaso_1a2b3c4d5e6f7g8h9i0jRAWSECRET",
      };
      keys = [...keys, { id: created.id, label, prefix: created.prefix, createdAt: created.createdAt, lastUsedAt: null }];
      return created;
    }
    if (method === "DELETE") {
      keys = keys.filter((k) => !path.endsWith(`/${k.id}`));
      return { revoked: true };
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  const client = {
    get: (p: string) => respond("GET", p),
    post: (p: string, b?: unknown) => respond("POST", p, b),
    request: (p: string, o?: { method?: string }) => respond(o?.method ?? "GET", p),
  } as unknown as ApiClient;
  return { client, events };
}

describe("ApiKeysCard", () => {
  it("gates generate on a label, mints a key, and reveals the raw secret exactly once", async () => {
    const { client } = fakeClient([]);
    render(<ApiKeysCard client={client} />);
    await waitFor(() => expect(screen.getByTestId("ak-create")).toBeTruthy());
    expect(screen.getByTestId("ak-create")).toBeDisabled(); // no label yet

    fireEvent.changeText(screen.getByTestId("ak-label"), "Claude Code");
    expect(screen.getByTestId("ak-create")).not.toBeDisabled();
    fireEvent.press(screen.getByTestId("ak-create"));

    // the raw secret is shown once, in the fresh-key panel
    await waitFor(() => expect(screen.getByTestId("ak-fresh-value")).toHaveTextContent(/RAWSECRET/));
    // and the once-only caveat is present
    expect(screen.getByTestId("ak-fresh")).toHaveTextContent(/only show it once/i);
  });

  it("lists keys by prefix + label only — never a raw secret", async () => {
    const { client } = fakeClient([
      { id: "k1", label: "CI", prefix: "shipaso_deadbeef…", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null },
    ]);
    render(<ApiKeysCard client={client} />);
    await waitFor(() => expect(screen.getByTestId("ak-k1")).toBeTruthy());
    expect(screen.getByTestId("ak-k1")).toHaveTextContent(/shipaso_deadbeef…/);
    expect(screen.getByTestId("ak-k1")).toHaveTextContent(/CI/);
    // no raw key material anywhere in the list row
    expect(screen.getByTestId("ak-k1")).not.toHaveTextContent(/RAWSECRET/);
  });

  it("revokes a key immediately (DELETE), removing it from the list", async () => {
    const { client, events } = fakeClient([
      { id: "k1", label: "CI", prefix: "shipaso_deadbeef…", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null },
    ]);
    render(<ApiKeysCard client={client} />);
    await waitFor(() => expect(screen.getByTestId("ak-revoke-k1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("ak-revoke-k1"));
    await waitFor(() => expect(events).toContain("DELETE /account/api-keys/k1"));
    await waitFor(() => expect(screen.queryByTestId("ak-k1")).toBeNull());
  });
});
