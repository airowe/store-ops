/**
 * The 404 route (#356 Phase 3).
 *
 * Until now an unknown path fell through the strangler edge to the LEGACY
 * dashboard, so a typo or a stale bookmark rendered a whole dashboard shell as
 * if the navigation had worked. Deleting `cloud/public/` removes that fallback,
 * so the new app has to answer for unknown paths itself.
 *
 * The honesty rule that applies here: say the path does not exist. Silently
 * redirecting to /dashboard would turn a mistake into an apparently successful
 * navigation, which is the same class of lie as rendering a plausible number we
 * never measured.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotFoundRoute } from "./notFound.js";

describe("<NotFoundRoute />", () => {
  it("says plainly that the page does not exist", () => {
    render(<NotFoundRoute />);
    expect(screen.getByTestId("not-found")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /page doesn't exist/i })).toBeInTheDocument();
  });

  it("never claims the navigation succeeded, and never auto-redirects", () => {
    render(<NotFoundRoute />);
    const text = screen.getByTestId("not-found").textContent ?? "";
    // No "redirecting…" / "taking you back" — the customer decides where to go.
    expect(text).not.toMatch(/redirect|taking you|sending you/i);
    // It does not invent a reason it cannot know (moved? renamed? deleted?).
    expect(text).not.toMatch(/moved|renamed|deleted/i);
  });

  it("offers a way out to real routes, as real links", () => {
    render(<NotFoundRoute />);
    const hrefs = Array.from(
      screen.getByTestId("not-found").querySelectorAll("a"),
    ).map((a) => a.getAttribute("href"));
    // Keyboard-operable by construction, and both targets are owned routes.
    expect(hrefs).toContain("/dashboard");
    expect(hrefs).toContain("/");
  });
});
