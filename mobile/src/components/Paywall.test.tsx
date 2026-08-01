/**
 * Paywall — the four states + the purchase/restore outcomes.
 *
 * The SDK wrapper (`../lib/purchases.js`) is mocked so these assert the UI
 * behavior; the wrapper's own mapping/gating is tested in lib/purchases.test.ts.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { Paywall } from "./Paywall.js";
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

const mockFetch = fetchOfferingPackages as jest.MockedFunction<typeof fetchOfferingPackages>;
const mockIap = hasActiveIapEntitlement as jest.MockedFunction<typeof hasActiveIapEntitlement>;
const mockBuy = purchasePackageById as jest.MockedFunction<typeof purchasePackageById>;
const mockRestore = restorePurchases as jest.MockedFunction<typeof restorePurchases>;

const PKG: PaywallPackage = {
  id: "scale_monthly",
  productId: "com.shipaso.scale.monthly",
  priceString: "$65.00",
  title: "Scale",
};

beforeEach(() => {
  mockFetch.mockReset();
  mockIap.mockReset();
  mockBuy.mockReset();
  mockRestore.mockReset();
  // sensible defaults; each test overrides what it cares about
  mockFetch.mockResolvedValue([PKG]);
  mockIap.mockResolvedValue(false);
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
