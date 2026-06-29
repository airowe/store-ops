import React from "react";
import { Text } from "react-native";
import { render, screen, waitFor, fireEvent } from "@testing-library/react-native";
import { Pressable } from "react-native";
import type { ApiClient } from "../api/client.js";
import type { Me } from "../types/api.js";
import { AuthProvider, useAuth } from "./AuthProvider.js";
import { clearToken, getToken, setToken } from "./session.js";

/** Minimal client that returns canned responses per path. */
function fakeClient(handlers: Record<string, unknown>): ApiClient {
  const call = async <T,>(path: string) => handlers[path] as T;
  return { get: call, post: call, request: call } as unknown as ApiClient;
}

function Consumer() {
  const { status, me, completeMagicLink } = useAuth();
  return (
    <>
      <Text testID="status">{status}</Text>
      <Text testID="email">{me?.email ?? "none"}</Text>
      <Pressable testID="do-magic" onPress={() => void completeMagicLink("magic-1")}>
        <Text>magic</Text>
      </Pressable>
    </>
  );
}

beforeEach(async () => {
  await clearToken();
});

describe("AuthProvider state machine", () => {
  it("no stored token → unauthed after boot", async () => {
    render(
      <AuthProvider clientOverride={fakeClient({})}>
        <Consumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("unauthed")).toBeTruthy());
  });

  it("stored token + authed /auth/me → authed with email", async () => {
    await setToken("sess-1");
    const me: Me = { authed: true, via: "session", email: "a@b.com" };
    render(
      <AuthProvider clientOverride={fakeClient({ "/auth/me": me })}>
        <Consumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("authed")).toBeTruthy());
    expect(screen.getByText("a@b.com")).toBeTruthy();
  });

  it("completeMagicLink exchanges, persists the token, and boots authed", async () => {
    const client = fakeClient({
      "/auth/exchange": { token: "sess-xyz", email: "a@b.com" },
      "/auth/me": { authed: true, via: "session", email: "a@b.com" } as Me,
    });
    render(
      <AuthProvider clientOverride={client}>
        <Consumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("unauthed")).toBeTruthy());

    fireEvent.press(screen.getByTestId("do-magic"));

    await waitFor(() => expect(screen.getByText("authed")).toBeTruthy());
    expect(await getToken()).toBe("sess-xyz");
  });
});
