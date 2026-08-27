/**
 * The rail's user chip, and the sign-in path that was missing from it.
 *
 * Observed in production Chrome while signed out: the chip rendered "You" over
 * "Fleet" — an invented identity for nobody — and the railed chrome offered no
 * route to /login at all. A visitor whose session had expired on /settings had
 * no way to sign back in without editing the URL.
 *
 * Two properties are asserted here rather than described: a signed-out rail
 * says so and offers a way in, and a signed-in rail shows the real operator.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createRouter, createRootRoute, createRoute, createMemoryHistory } from "@tanstack/react-router";
import { NavRail } from "./NavRail.js";

// The router restores scroll on mount; jsdom has no window.scrollTo and logs a
// stack for every render. Unrelated to anything asserted here, and a suite that
// prints noise teaches people to stop reading it.
beforeAll(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

function renderRail(operator: string | null) {
  const rootRoute = createRootRoute();
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <NavRail active="settings" operator={operator} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("<NavRail /> user chip", () => {
  it("shows the operator's email when there IS a session", async () => {
    renderRail("me@example.com");
    expect(await screen.findByTestId("rail-user")).toHaveTextContent("me@example.com");
  });

  it("does NOT invent an identity when signed out", async () => {
    renderRail(null);
    const chip = await screen.findByTestId("rail-user");
    // "You" named a person who is not there; "Fleet" described their plan.
    expect(chip).not.toHaveTextContent("You");
    expect(chip).toHaveTextContent(/signed out/i);
  });

  it("offers a way to sign in when signed out — the rail had no route to /login", async () => {
    renderRail(null);
    expect(await screen.findByTestId("rail-signin")).toHaveAttribute("href", "/login");
  });

  it("offers no sign-in link when a session is present", async () => {
    renderRail("me@example.com");
    await screen.findByTestId("rail-user");
    expect(screen.queryByTestId("rail-signin")).not.toBeInTheDocument();
  });
});
