import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrivacyView } from "./PrivacyView.js";

describe("<PrivacyView />", () => {
  it("states the load-bearing claims that must match the App Privacy declaration", () => {
    render(<PrivacyView />);
    // Only email is collected, for magic-link sign-in.
    expect(screen.getByTestId("privacy-data-collected")).toHaveTextContent(/email/i);
    expect(screen.getByTestId("privacy-data-collected")).toHaveTextContent(/sign-in/i);
    // No tracking.
    expect(screen.getByTestId("privacy-no-tracking")).toHaveTextContent(/no tracking/i);
    // Store/API credentials are never persisted.
    expect(screen.getByTestId("privacy-credentials")).toHaveTextContent(/never (stored|persisted)/i);
    // Contact address present.
    expect(screen.getByTestId("privacy-contact")).toHaveTextContent("support@shipaso.com");
    // Effective date present.
    expect(screen.getByTestId("privacy-effective")).toHaveTextContent("2026-07-17");
  });
});
