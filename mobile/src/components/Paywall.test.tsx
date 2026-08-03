/**
 * Paywall — the four states + the purchase/restore outcomes.
 *
 * The SDK wrapper (`../lib/purchases.js`) is mocked so these assert the UI
 * behavior; the wrapper's own mapping/gating is tested in lib/purchases.test.ts.
 */
import { Linking } from "react-native";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { Paywall } from "./Paywall.js";
import { legalUrls } from "../lib/legalUrls.js";
import {
  fetchOfferingPackages,
  hasActiveIapEntitlement,
  purchasePackageById,
  restorePurchases,
  type PaywallPackage,
} from "../lib/purchases.js";

jest.mock("../lib/purchases.js", () => ({
  fetchOfferingPackages: jest.fn(),
  hasActiveIapEntitlement: jest.fn(),
  purchasePackageById: jest.fn(),
  restorePurchases: jest.fn(),
}));

jest.mock("../lib/legalUrls.js", () => ({ legalUrls: jest.fn() }));
const mockLegal = legalUrls as jest.MockedFunction<typeof legalUrls>;
const LEGAL = { terms: "https://shipaso.com/terms", privacy: "https://shipaso.com/privacy" };

// Spy rather than jest.mock: the module path moves between RN versions, and a
// wrong path fails the whole suite at import time rather than at the assertion.
const mockOpenURL = jest.spyOn(Linking, "openURL");

const mockFetch = fetchOfferingPackages as jest.MockedFunction<typeof fetchOfferingPackages>;
const mockIap = hasActiveIapEntitlement as jest.MockedFunction<typeof hasActiveIapEntitlement>;
const mockBuy = purchasePackageById as jest.MockedFunction<typeof purchasePackageById>;
const mockRestore = restorePurchases as jest.MockedFunction<typeof restorePurchases>;

const PKG: PaywallPackage = {
  id: "scale_monthly",
  productId: "com.shipaso.scale.monthly",
  priceString: "$65.00",
  title: "Scale",
  description: "Unlimited apps, weekly autonomous runs, and the full keyword corpus.",
  subscriptionPeriod: "P1M",
};

beforeEach(() => {
  mockFetch.mockReset();
  mockIap.mockReset();
  mockBuy.mockReset();
  mockRestore.mockReset();
  mockLegal.mockReset();
  mockOpenURL.mockReset();
  // sensible defaults; each test overrides what it cares about
  mockFetch.mockResolvedValue([PKG]);
  mockIap.mockResolvedValue(false);
  mockLegal.mockReturnValue(LEGAL);
  mockOpenURL.mockResolvedValue(undefined);
});

describe("Paywall", () => {
  it("shows a read-only 'managed on the web' state for a paid tier with no IAP entitlement", async () => {
    mockIap.mockResolvedValue(false);
    render(<Paywall tier="startup" />);
    await waitFor(() => expect(screen.getByTestId("paywall-managed-web")).toBeTruthy());
    // no purchase button — 3.1.3: never offer to sell to a web subscriber in-app
    expect(screen.queryByTestId(`paywall-buy-${PKG.id}`)).toBeNull();
  });

  it("shows 'unavailable' when there is no offering (RevenueCat not provisioned)", async () => {
    mockFetch.mockResolvedValue([]);
    render(<Paywall tier="free" />);
    await waitFor(() => expect(screen.getByTestId("paywall-unavailable")).toBeTruthy());
  });

  it("renders the offering's packages with a native Buy button for a free user", async () => {
    render(<Paywall tier="free" />);
    await waitFor(() => expect(screen.getByTestId(`paywall-buy-${PKG.id}`)).toBeTruthy());
    expect(screen.getByText(/Scale — \$65\.00/)).toBeTruthy();
  });

  it("calls onDone after a successful purchase", async () => {
    mockBuy.mockResolvedValue("purchased");
    const onDone = jest.fn();
    render(<Paywall tier="free" onDone={onDone} />);
    fireEvent.press(await screen.findByTestId(`paywall-buy-${PKG.id}`));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mockBuy).toHaveBeenCalledWith(PKG.id);
  });

  it("surfaces an error and does NOT call onDone when the purchase fails", async () => {
    mockBuy.mockResolvedValue("error");
    const onDone = jest.fn();
    render(<Paywall tier="free" onDone={onDone} />);
    fireEvent.press(await screen.findByTestId(`paywall-buy-${PKG.id}`));
    await waitFor(() => expect(screen.getByTestId("paywall-error")).toBeTruthy());
    expect(onDone).not.toHaveBeenCalled();
  });

  it("stays silent (no error, no onDone) when the user cancels the purchase", async () => {
    mockBuy.mockResolvedValue("cancelled");
    const onDone = jest.fn();
    render(<Paywall tier="free" onDone={onDone} />);
    fireEvent.press(await screen.findByTestId(`paywall-buy-${PKG.id}`));
    await waitFor(() => expect(mockBuy).toHaveBeenCalled());
    expect(screen.queryByTestId("paywall-error")).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("restores purchases: onDone on success, a message when there is nothing to restore", async () => {
    mockRestore.mockResolvedValueOnce(true);
    const onDone = jest.fn();
    const { rerender } = render(<Paywall tier="free" onDone={onDone} />);
    fireEvent.press(await screen.findByTestId("paywall-restore"));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    mockRestore.mockResolvedValueOnce(false);
    rerender(<Paywall tier="free" onDone={onDone} />);
    fireEvent.press(await screen.findByTestId("paywall-restore"));
    await waitFor(() => expect(screen.getByTestId("paywall-error")).toBeTruthy());
  });
});

/**
 * Guideline 3.1.2(c) + 5.1.1(i) — issue #430.
 *
 * A purchase screen that shows only "Scale — $65.00" does not tell the user
 * what they are agreeing to. ShipASO 0.1.0 was already rejected under 3.1.1 AND
 * 2.3.7 in one review, so the next submission goes to a reviewer who has failed
 * this app on payments and on price presentation. These assert the disclosures
 * a reviewer looks for.
 */
describe("Paywall — subscription disclosure", () => {
  it("states the price per period, that it renews, and where to cancel", async () => {
    render(<Paywall tier="free" />);
    const disclosure = await screen.findByTestId(`paywall-terms-${PKG.id}`);
    expect(disclosure).toHaveTextContent(/\$65\.00 per month/);
    expect(disclosure).toHaveTextContent(/renews automatically until cancelled/i);
    expect(disclosure).toHaveTextContent(/manage or cancel/i);
  });

  it("says what the tier includes", async () => {
    render(<Paywall tier="free" />);
    expect(await screen.findByTestId(`paywall-includes-${PKG.id}`)).toBeTruthy();
  });

  /**
   * StoreKit 1 and Amazon can return a null period. Omitting the rate is
   * honest; printing "per month" beside a real price would misstate the
   * product. The renewal facts stay because they remain true.
   */
  it("omits the rate but keeps the renewal facts when the period is unknown", async () => {
    mockFetch.mockResolvedValue([{ ...PKG, subscriptionPeriod: null }]);
    render(<Paywall tier="free" />);
    const disclosure = await screen.findByTestId(`paywall-terms-${PKG.id}`);
    expect(disclosure).toHaveTextContent(/renews automatically until cancelled/i);
    expect(disclosure).not.toHaveTextContent(/per month|per year|per week/i);
  });

  it("links to the Terms of Use and the privacy policy", async () => {
    render(<Paywall tier="free" />);
    fireEvent.press(await screen.findByTestId("paywall-terms-link"));
    expect(mockOpenURL).toHaveBeenCalledWith(LEGAL.terms);

    fireEvent.press(screen.getByTestId("paywall-privacy-link"));
    expect(mockOpenURL).toHaveBeenCalledWith(LEGAL.privacy);
  });

  /**
   * Neither URL is published yet — both 404 on shipaso.com today. A link to a
   * 404 from a purchase screen is its own rejection (0.1.0 was cited under
   * 2.1(a) for exactly that), so an unset URL renders NO control.
   */
  it("renders no link at all when a URL is unconfigured", async () => {
    mockLegal.mockReturnValue({ terms: null, privacy: null });
    render(<Paywall tier="free" />);
    await screen.findByTestId(`paywall-buy-${PKG.id}`);
    expect(screen.queryByTestId("paywall-terms-link")).toBeNull();
    expect(screen.queryByTestId("paywall-privacy-link")).toBeNull();
  });

  it("renders each link independently — one missing must not hide the other", async () => {
    mockLegal.mockReturnValue({ terms: null, privacy: LEGAL.privacy });
    render(<Paywall tier="free" />);
    expect(await screen.findByTestId("paywall-privacy-link")).toBeTruthy();
    expect(screen.queryByTestId("paywall-terms-link")).toBeNull();
  });

  /**
   * 3.1.3: a web subscriber is shown their tier read-only. No buy button means
   * no purchase to disclose — but it must not accidentally grow one.
   */
  it("shows no purchase disclosure in the managed-on-web state", async () => {
    render(<Paywall tier="startup" />);
    await screen.findByTestId("paywall-managed-web");
    expect(screen.queryByTestId(`paywall-terms-${PKG.id}`)).toBeNull();
  });
});
