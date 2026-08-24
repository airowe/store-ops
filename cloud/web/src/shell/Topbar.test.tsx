import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Topbar } from "./Topbar.js";

describe("<Topbar />", () => {
  it("live backend + real session → shows the email + a live env pill", () => {
    render(<Topbar apiBase="https://api.shipaso.com" session={{ authed: true, via: "session", email: "me@x.com" }} />);
    expect(screen.getByTestId("who-email")).toHaveTextContent("me@x.com");
    const pill = screen.getByTestId("env-pill");
    expect(pill).toHaveTextContent("live · api.shipaso.com");
    expect(pill.className).toContain("live");
  });

  it("live backend + logged out → a Sign in control, never the demo stub", () => {
    render(<Topbar apiBase="https://api.shipaso.com" session={{ authed: false }} />);
    expect(screen.getByTestId("sign-in")).toBeInTheDocument();
    expect(screen.queryByText(/acting as/i)).toBeNull();
  });

  // Regression: this shipped as <button type="button"> with no onClick and no
  // href — styled, labelled, and completely inert. Clicking it did nothing, in
  // silence. The old assertion (toBeInTheDocument) passed the whole time,
  // because existing-and-doing-nothing is still existing. An App Review
  // rejection cited the same failure mode on the Connect button.
  it("points Sign in at /login — a control that goes nowhere is not a control", () => {
    render(<Topbar apiBase="https://api.shipaso.com" session={{ authed: false }} />);
    expect(screen.getByTestId("sign-in")).toHaveAttribute("href", "/login");
  });

  it("no API base → demo pill + the acting-as stub", () => {
    render(<Topbar apiBase={null} session={null} />);
    expect(screen.getByTestId("env-pill")).toHaveTextContent("demo backend");
    expect(screen.getByText(/acting as/i)).toBeInTheDocument();
  });

  it("links the logo to /dashboard when signed in", () => {
    render(<Topbar apiBase="https://api.shipaso.com" session={{ authed: true, via: "session", email: "me@x.com" }} />);
    expect(screen.getByTestId("logo-link")).toHaveAttribute("href", "/dashboard");
  });

  it("links the logo to / when signed out", () => {
    render(<Topbar apiBase="https://api.shipaso.com" session={{ authed: false }} />);
    expect(screen.getByTestId("logo-link")).toHaveAttribute("href", "/");
  });
});
