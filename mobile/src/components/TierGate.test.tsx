import { render, screen } from "@testing-library/react-native";
import { TierGate } from "./TierGate.js";

// createElement rather than JSX: a mock factory is hoisted above the file's
// imports, so JSX inside it is not transformed.
jest.mock("./Paywall.js", () => ({
  Paywall: ({ tier }: { tier?: string }) => {
    const react = require("react");
    const { Text } = require("react-native");
    return react.createElement(Text, { testID: "paywall" }, `paywall:${tier ?? "none"}`);
  },
}));

/**
 * The 402 surface, after RevenueCat.
 *
 * ShipASO 0.1.0 was rejected under Guideline 3.1.1 for opening a Stripe
 * checkout in the system browser, and the fix at the time was to sell nothing:
 * the gate explained the tier and pointed at shipaso.com. That constraint is
 * now lifted — the app sells through native IAP — so a gated screen offers the
 * upgrade in-app instead of sending the user to the web.
 *
 * What must NOT come back is the web checkout. `packages/docpaths/noIapPurchasePath.test.mjs`
 * still forbids `billingCheckout` / `openBrowserAsync(url)` / `ExternalPurchaseLink`;
 * those are the 3.1.1/3.1.3 paths, and native IAP is not one of them.
 *
 * This component exists so both gated screens (portfolio, war room) share one
 * tested surface rather than each growing their own copy of the rules.
 */
describe("TierGate", () => {
  it("names the feature and the tier it needs", () => {
    render(<TierGate feature="Portfolio" requires="scale" tier="free" />);
    expect(screen.getByText(/Portfolio is a Scale feature/i)).toBeTruthy();
  });

  it("shows the server's explanation when there is one", () => {
    render(
      <TierGate feature="Portfolio" requires="scale" tier="free" detail="The fleet roll-up needs the Scale plan." />,
    );
    expect(screen.getByText("The fleet roll-up needs the Scale plan.")).toBeTruthy();
  });

  it("mounts the paywall so the user can upgrade in-app", () => {
    render(<TierGate feature="Portfolio" requires="scale" tier="free" />);
    expect(screen.getByTestId("paywall")).toBeTruthy();
  });

  it("passes the user's current tier to the paywall", () => {
    render(<TierGate feature="War room" requires="scale" tier="indie" />);
    expect(screen.getByTestId("paywall")).toHaveTextContent("paywall:indie");
  });

  /**
   * The old copy sent people to the web to buy. With IAP live that is the
   * thing Apple objects to under 3.1.1 — steering out of the app — so it must
   * not survive alongside a native purchase path.
   */
  it("does not tell the user to go to the web to buy", () => {
    render(<TierGate feature="Portfolio" requires="scale" tier="free" />);
    expect(screen.queryByText(/managed at shipaso\.com/i)).toBeNull();
    expect(screen.queryByText(/shipaso\.com/i)).toBeNull();
  });
});
