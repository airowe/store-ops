import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import type { ApiClient } from "../../src/api/client.js";
import { AuthProvider } from "../../src/auth/AuthProvider.js";
import { clearToken } from "../../src/auth/session.js";
import Login from "./login.js";

// Login redirects with expo-router's <Redirect> once auth completes in place;
// surface the target href so the test can assert on it.
jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text: T } = jest.requireActual("react-native");
    return <T testID="redirect-target">{String(href)}</T>;
  },
}));
function fakeClient(onPost: (path: string, body: unknown) => void): ApiClient {
  const call = async <T,>(path: string, body?: unknown) => {
    onPost(path, body);
    return {} as T;
  };
  return { get: call, post: call, request: call } as unknown as ApiClient;
}

beforeEach(async () => {
  await clearToken();
});

describe("Login screen", () => {
  it("send is disabled until the email looks valid, then requests a link", async () => {
    const posts: Array<{ path: string; body: unknown }> = [];
    render(
      <AuthProvider clientOverride={fakeClient((path, body) => posts.push({ path, body }))}>
        <Login />
      </AuthProvider>,
    );

    // invalid email → pressing send does nothing
    fireEvent.changeText(screen.getByTestId("email-input"), "nope");
    fireEvent.press(screen.getByTestId("send-link"));
    expect(posts.find((p) => p.path === "/auth/request")).toBeUndefined();

    // valid email → /auth/request fired + confirmation shown
    fireEvent.changeText(screen.getByTestId("email-input"), "user@example.com");
    fireEvent.press(screen.getByTestId("send-link"));

    await waitFor(() => expect(posts.find((p) => p.path === "/auth/request")).toBeTruthy());
    expect(posts.find((p) => p.path === "/auth/request")!.body).toEqual({ email: "user@example.com" });
    await waitFor(() => expect(screen.getByText(/sign-in link is on its way/)).toBeTruthy());
  });

  it("redirects into the app once a pasted token signs in", async () => {
    const client = {
      post: async <T,>(path: string) => {
        expect(path).toBe("/auth/exchange");
        return { token: "sess-1", email: "user@example.com" } as T;
      },
      get: async <T,>() => ({ authed: true, email: "user@example.com" }) as T,
      request: async <T,>() => ({}) as T,
    } as unknown as ApiClient;

    render(
      <AuthProvider clientOverride={client}>
        <Login />
      </AuthProvider>,
    );

    fireEvent.changeText(screen.getByTestId("token-input"), "magic-token");
    fireEvent.press(screen.getByText("Continue"));

    await waitFor(() => expect(screen.getByTestId("redirect-target").props.children).toBe("/(app)"));
  });
});
