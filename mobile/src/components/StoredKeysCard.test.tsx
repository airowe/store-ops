/**
 * StoredKeysCard (#67 Phase 2, mobile) — write-only management. Pins: metadata
 * only (never key material), honest "does not revoke at Apple" copy, delete
 * removes the row, and the disabled state when the deployment has no KEK.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { StoredKeysCard } from "./StoredKeysCard.js";
import type { ApiClient } from "../api/client.js";
import type { StoredCredential } from "../api/endpoints.js";

function fakeClient(initial: { enabled: boolean; credentials: StoredCredential[] }) {
  let creds = [...initial.credentials];
  const client = {
    get: async () => ({ enabled: initial.enabled, credentials: creds }),
    post: async () => ({}),
    request: async (path: string) => {
      creds = creds.filter((c) => !path.includes("/" + c.kind));
      return { deleted: true, note: "Removed from ShipASO. This does NOT revoke the key at Apple." };
    },
  } as unknown as ApiClient;
  return client;
}

const CRED: StoredCredential = {
  id: "c1", appId: "app1", kind: "asc", keyId: "ABC123", issuerId: "iss",
  createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null, kekVersion: 1,
};

describe("StoredKeysCard", () => {
  it("lists metadata only + the honest revoke caveat; delete removes the row", async () => {
    render(<StoredKeysCard client={fakeClient({ enabled: true, credentials: [CRED] })} />);
    await waitFor(() => expect(screen.getByTestId("stored-key-c1")).toBeTruthy());
    expect(screen.getByText(/App Store Connect · ABC123/)).toBeTruthy();
    expect(screen.getByText(/does not revoke the key at Apple/)).toBeTruthy();
    // no key material anywhere
    expect(screen.queryByText(/PRIVATE KEY/)).toBeNull();

    fireEvent.press(screen.getByTestId("delete-key-c1"));
    await waitFor(() => expect(screen.getByTestId("stored-keys-empty")).toBeTruthy());
  });

  it("no-KEK deployment → honest disabled state", async () => {
    render(<StoredKeysCard client={fakeClient({ enabled: false, credentials: [] })} />);
    await waitFor(() => expect(screen.getByTestId("stored-keys-disabled")).toBeTruthy());
  });
});
