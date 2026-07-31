/**
 * The magic-link landing route.
 *
 * The App Store association file advertises `/auth/m` (it is in the AASA at
 * shipaso.com), and #421 made iOS actually fetch it — so a tapped sign-in link
 * now hands off to the app instead of staying in Safari. But there was no route
 * FILE at that path, so expo-router rendered its 404:
 *
 *     [Heading] Unmatched Route
 *     [Heading] Page could not be found.
 *     [Link] shipaso:///auth/m?token=…
 *
 * Caught on an iPad simulator (iOS 26.5, matching the reviewer's iPadOS 26.5.2)
 * by reading the accessibility tree — `simctl openurl` reports success either
 * way, so nothing short of inspecting the rendered UI would have shown it.
 *
 * Auth itself was never broken: AuthProvider captures the token from
 * `Linking.getInitialURL()`, independent of routing. But the reviewer who
 * rejected 0.1.0 for "the sign in link does not link user back to the app"
 * would have tapped the link and read "Page could not be found."
 *
 * So this screen exists to be the thing on screen WHILE the token is exchanged,
 * and to route onward when it resolves. It deliberately holds no auth logic of
 * its own — duplicating the exchange here would risk consuming a single-use
 * token twice.
 */
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { useColorScheme } from "react-native";
import { ThemeProvider } from "../../src/theme/index.js";
import type { AuthStatus } from "../../src/auth/AuthProvider.js";

jest.mock("react-native/Libraries/Utilities/useColorScheme");
(useColorScheme as unknown as jest.Mock).mockReturnValue("dark");

const mockRedirect = jest.fn((_props: { href: string }) => null);
jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
  Stack: { Screen: () => null },
}));

let mockStatus: AuthStatus = "loading";
jest.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ status: mockStatus }),
}));

import AuthLanding from "./m.js";

const renderAt = (s: AuthStatus) => {
  mockStatus = s;
  return render(
    <ThemeProvider>
      <AuthLanding />
    </ThemeProvider>,
  );
};

beforeEach(() => mockRedirect.mockClear());

describe("the /auth/m landing route", () => {
  it("says it is signing you in while the token is exchanged", () => {
    renderAt("loading");
    // The whole point: something honest on screen instead of expo-router's
    // "Page could not be found."
    expect(screen.getByText(/signing you in/i)).toBeTruthy();
    expect(screen.queryByText(/could not be found/i)).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("sends an authed user into the app", () => {
    renderAt("authed");
    expect(mockRedirect).toHaveBeenCalledWith(expect.objectContaining({ href: "/(app)" }));
  });

  /**
   * An expired or already-used link resolves to unauthed. Landing on login is
   * the honest destination — the alternative is stranding the user on a
   * spinner, which is what AuthProvider's own comment warns against.
   */
  it("sends a failed or expired link to login rather than stranding it", () => {
    renderAt("unauthed");
    expect(mockRedirect).toHaveBeenCalledWith(
      expect.objectContaining({ href: "/(public)/login" }),
    );
  });
});
