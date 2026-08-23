import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SupportView } from "./SupportView.js";

describe("<SupportView />", () => {
  it("gives a reachable contact address — the reason App Review checks this page", () => {
    render(<SupportView />);
    const contact = screen.getByTestId("support-contact");
    expect(contact).toHaveTextContent("support@shipaso.com");
    expect(contact.querySelector('a[href="mailto:support@shipaso.com"]')).not.toBeNull();
  });

  it("states a response-time commitment we can actually keep", () => {
    render(<SupportView />);
    expect(screen.getByTestId("support-response")).toHaveTextContent(/business day/i);
  });

  it("tells a signed-out user how to get back in without a password", () => {
    render(<SupportView />);
    expect(screen.getByTestId("support-signin")).toHaveTextContent(/magic|link/i);
  });

  it("says approving is not shipping — the invariant the whole product rests on", () => {
    render(<SupportView />);
    expect(screen.getByTestId("support-approval")).toHaveTextContent(/never|not/i);
    expect(screen.getByTestId("support-approval")).toHaveTextContent(/App Store|store/i);
  });

  it("points at the subscription cancellation path Apple requires", () => {
    render(<SupportView />);
    expect(screen.getByTestId("support-billing")).toHaveTextContent(/cancel/i);
    expect(screen.getByTestId("support-billing")).toHaveTextContent(/Apple|App Store|Settings/i);
  });

  it("links the privacy policy and terms", () => {
    render(<SupportView />);
    const links = screen.getByTestId("support-legal");
    expect(links.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(links.querySelector('a[href="/terms"]')).not.toBeNull();
  });
});
