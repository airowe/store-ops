/**
 * RevenueCat wrapper — mapping, gating, and purchase-outcome handling.
 *
 * The SDK (`react-native-purchases`) and `./config.js` are mocked per test inside
 * an isolated module registry so the wrapper's one-time `configured` state starts
 * fresh each time (unconfigured vs configured are different module lifetimes).
 */

type Sdk = {
  configure: jest.Mock;
  logIn: jest.Mock;
  logOut: jest.Mock;
  getOfferings: jest.Mock;
  purchasePackage: jest.Mock;
  restorePurchases: jest.Mock;
  getCustomerInfo: jest.Mock;
  addCustomerInfoUpdateListener: jest.Mock;
};

const emptyInfo = { entitlements: { active: {}, all: {} } };
const rcPkg = {
  identifier: "scale_monthly",
  product: { identifier: "com.shipaso.scale.monthly", priceString: "$65.00", title: "Scale" },
};
const offeringOf = (pkgs: unknown[]) => ({
  current: pkgs.length ? { availablePackages: pkgs } : null,
  all: {},
});

function makeSdk(over: Partial<Sdk> = {}): Sdk {
  return {
    configure: jest.fn(),
    logIn: jest.fn(async () => ({ customerInfo: emptyInfo, created: false })),
    logOut: jest.fn(async () => emptyInfo),
    getOfferings: jest.fn(async () => offeringOf([])),
    purchasePackage: jest.fn(async () => ({ customerInfo: emptyInfo, productIdentifier: "x" })),
    restorePurchases: jest.fn(async () => emptyInfo),
    getCustomerInfo: jest.fn(async () => emptyInfo),
    addCustomerInfoUpdateListener: jest.fn(),
    ...over,
  };
}

function loadWrapper(apiKey: string | null, sdk: Sdk): typeof import("./purchases.js") {
  let mod!: typeof import("./purchases.js");
  jest.isolateModules(() => {
    jest.doMock("./config.js", () => ({
      __esModule: true,
      revenueCatApiKey: () => apiKey,
      apiBase: () => "https://api.shipaso.com",
    }));
    jest.doMock("react-native-purchases", () => ({ __esModule: true, default: sdk }));
    // require (not dynamic import): jest-expo runs CJS, so `await import()` throws
    // "without --experimental-vm-modules". The `.js` specifier maps to the TS source.
    mod = require("./purchases.js") as typeof import("./purchases.js");
  });
  return mod;
}

describe("purchases wrapper — unconfigured (no API key)", () => {
  it("returns false from configure and degrades every call safely", async () => {
    const sdk = makeSdk();
    const w = await loadWrapper(null, sdk);
    expect(w.configurePurchases("u1")).toBe(false);
    expect(w.isPurchasesConfigured()).toBe(false);
    expect(await w.fetchOfferingPackages()).toEqual([]);
    expect(await w.hasActiveIapEntitlement()).toBe(false);
    expect(await w.restorePurchases()).toBe(false);
    expect(await w.purchasePackageById("x")).toBe("error");
    expect(sdk.configure).not.toHaveBeenCalled();
  });
});

describe("purchases wrapper — configured", () => {
  it("configures once (idempotent) with the platform key + appUserID", async () => {
    const sdk = makeSdk();
    const w = await loadWrapper("appl_key", sdk);
    expect(w.configurePurchases("user-1")).toBe(true);
    expect(sdk.configure).toHaveBeenCalledWith({ apiKey: "appl_key", appUserID: "user-1" });
    expect(w.configurePurchases("user-1")).toBe(true);
    expect(sdk.configure).toHaveBeenCalledTimes(1);
  });

  it("maps the current offering's packages to app-shaped packages", async () => {
    const sdk = makeSdk({ getOfferings: jest.fn(async () => offeringOf([rcPkg])) });
    const w = await loadWrapper("appl_key", sdk);
    w.configurePurchases("u1");
    expect(await w.fetchOfferingPackages()).toEqual([
      {
        id: "scale_monthly",
        productId: "com.shipaso.scale.monthly",
        priceString: "$65.00",
        title: "Scale",
      },
    ]);
  });

  it("purchase → 'purchased' on success", async () => {
    const sdk = makeSdk({ getOfferings: jest.fn(async () => offeringOf([rcPkg])) });
    const w = await loadWrapper("appl_key", sdk);
    w.configurePurchases("u1");
    expect(await w.purchasePackageById("scale_monthly")).toBe("purchased");
    expect(sdk.purchasePackage).toHaveBeenCalledWith(rcPkg);
  });

  it("purchase → 'cancelled' when the user backs out (userCancelled)", async () => {
    const err = Object.assign(new Error("cancel"), { userCancelled: true });
    const sdk = makeSdk({
      getOfferings: jest.fn(async () => offeringOf([rcPkg])),
      purchasePackage: jest.fn(async () => {
        throw err;
      }),
    });
    const w = await loadWrapper("appl_key", sdk);
    w.configurePurchases("u1");
    expect(await w.purchasePackageById("scale_monthly")).toBe("cancelled");
  });

  it("purchase → 'error' on any other failure and for an unknown package", async () => {
    const sdk = makeSdk({
      getOfferings: jest.fn(async () => offeringOf([rcPkg])),
      purchasePackage: jest.fn(async () => {
        throw new Error("network");
      }),
    });
    const w = await loadWrapper("appl_key", sdk);
    w.configurePurchases("u1");
    expect(await w.purchasePackageById("scale_monthly")).toBe("error");
    expect(await w.purchasePackageById("does_not_exist")).toBe("error");
  });

  it("detects an active IAP entitlement", async () => {
    const active = { entitlements: { active: { pro: { identifier: "pro" } }, all: {} } };
    const sdk = makeSdk({ getCustomerInfo: jest.fn(async () => active) });
    const w = await loadWrapper("appl_key", sdk);
    w.configurePurchases("u1");
    expect(await w.hasActiveIapEntitlement()).toBe(true);
  });

  it("restore returns whether an entitlement is now active", async () => {
    const active = { entitlements: { active: { pro: {} }, all: {} } };
    const sdk = makeSdk({ restorePurchases: jest.fn(async () => active) });
    const w = await loadWrapper("appl_key", sdk);
    w.configurePurchases("u1");
    expect(await w.restorePurchases()).toBe(true);
  });

  it("login / logout call through when configured", async () => {
    const sdk = makeSdk();
    const w = await loadWrapper("appl_key", sdk);
    w.configurePurchases("u1");
    await w.loginPurchases("user-2");
    expect(sdk.logIn).toHaveBeenCalledWith("user-2");
    await w.logoutPurchases();
    expect(sdk.logOut).toHaveBeenCalled();
  });
});
