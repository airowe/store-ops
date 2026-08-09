import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TermsView } from "./TermsView.js";

/**
 * The Terms of Use (EULA) is a REVIEW REQUIREMENT, not a formality: Apple
 * requires a functional Terms link on any screen selling an auto-renewable
 * subscription (3.1.2), and ShipASO 0.1.0 already ate a 2.1(a) rejection for a
 * link that 404'd. These assert the clauses the paywall's disclosure promises,
 * so the page and `renewalSentence()` cannot drift apart.
 */
describe("<TermsView />", () => {
  it("states the subscription terms Apple requires on the purchase screen", () => {
    render(<TermsView />);
    // The three tiers and their prices — must match docs/landing/pricing.md.
    const tiers = screen.getByTestId("terms-tiers");
    expect(tiers).toHaveTextContent("$7");
    expect(tiers).toHaveTextContent("$19");
    expect(tiers).toHaveTextContent("$65");
    // Auto-renewal + where to cancel (the paywall says the same sentence).
    expect(screen.getByTestId("terms-renewal")).toHaveTextContent(/renews? automatically/i);
    expect(screen.getByTestId("terms-renewal")).toHaveTextContent(/cancel/i);
    // Billed through the App Store, not us — sets the refund expectation.
    expect(screen.getByTestId("terms-billing")).toHaveTextContent(/App Store/i);
    // Honesty model: unmeasured values render "—". Stated so a subscriber
    // cannot claim the product promised numbers it declines to guess at.
    expect(screen.getByTestId("terms-honesty")).toHaveTextContent(/measured/i);
    // Approval is the terminus — nothing ships to a store without the user.
    expect(screen.getByTestId("terms-approval")).toHaveTextContent(/approve/i);
    expect(screen.getByTestId("terms-contact")).toHaveTextContent("support@shipaso.com");
    expect(screen.getByTestId("terms-effective")).toHaveTextContent(/20\d\d-\d\d-\d\d/);
  });
});
