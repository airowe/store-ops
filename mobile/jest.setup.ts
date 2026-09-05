/**
 * Jest setup — mock the native modules the app touches so tests run headless
 * (no device). expo-secure-store is mocked with an in-memory store; the
 * credential tests assert that the credential value NEVER reaches it.
 */
import "@testing-library/react-native";

// AsyncStorage: the library ships an in-memory jest mock; the theme provider
// (light/dark preference) reads/writes it, so wire it up globally.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// expo-image (57.0.2) wires an "expo-observe" integration at import time:
//   const observe = requireOptionalNativeModule<ObserveModule>('ExpoObserve');
//   if (!observe) return;
//   activate(state, observe.getIntegrations());
// expo-observe is NOT a declared dependency of expo-image, so it is absent from
// node_modules. Under jest-expo `requireOptionalNativeModule` returns a mock
// object rather than null, so the guard passes and getIntegrations() — which
// does not exist on the mock — throws at import, failing every suite that
// renders an <Image>. Returning null for this one module restores the intended
// "integration unavailable" path.
jest.mock("expo", () => {
  const actual = jest.requireActual("expo");
  return {
    ...actual,
    requireOptionalNativeModule: (name: string) =>
      name === "ExpoObserve" ? null : actual.requireOptionalNativeModule(name),
  };
});

// react-native-graph renders via Skia + reanimated worklets (native) — mock it
// to a plain View so component tests stay headless. The honest data mapping is
// tested separately (src/lib/rankSeries.test.ts).
jest.mock("react-native-graph", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    LineGraph: (_props: Record<string, unknown>) => React.createElement(View, { testID: "line-graph" }),
    SelectionDot: () => null,
  };
});

// Safe-area context: the Screen primitive now reads useSafeAreaInsets(), which
// throws without a <SafeAreaProvider> ancestor. The library ships a jest mock
// that returns zero insets, so every screen test stays headless without each one
// wrapping a provider. (App root wires the real provider in app/_layout.tsx.)
jest.mock("react-native-safe-area-context", () => {
  // The shipped mock exposes everything under a default export; re-expose as
  // named exports (useSafeAreaInsets, SafeAreaProvider, …) which is how the app
  // imports them.
  const mock = require("react-native-safe-area-context/jest/mock");
  return mock.default ?? mock;
});

// In-memory SecureStore so session-token persistence is observable in tests.
jest.mock("expo-secure-store", () => {
  const mem = new Map<string, string>();
  return {
    __mem: mem,
    getItemAsync: jest.fn(async (k: string) => mem.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void mem.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void mem.delete(k)),
  };
});

// Document picker: default to "canceled" so tests opt into a file explicitly.
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

// File system: observable spies so the never-persisted credential tests can
// assert that NO write API is ever handed a credential value.
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  documentDirectory: "file:///docs/",
  readAsStringAsync: jest.fn(async () => ""),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  downloadAsync: jest.fn(async (_u: string, t: string) => ({ status: 200, uri: t, headers: {} })),
  copyAsync: jest.fn(async () => undefined),
}));

// Notifications: default to granted + a stable token; tests override per-case.
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExpoPushToken[jest-device]" })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock("expo-linking", () => ({
  createURL: (path: string) => `shipaso://${path}`,
  parse: (url: string) => ({ queryParams: Object.fromEntries(new URL(url).searchParams) }),
  useURL: () => null,
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  openURL: jest.fn(async () => true),
}));

// RevenueCat native SDK: a benign default so any transitive import (the purchases
// wrapper, AuthProvider) stays headless. No entitlements + no offering by default;
// the wrapper/paywall tests drive behavior by mocking the wrapper or these fns.
jest.mock("react-native-purchases", () => {
  const emptyInfo = { entitlements: { active: {}, all: {} } };
  return {
    __esModule: true,
    default: {
      configure: jest.fn(),
      logIn: jest.fn(async () => ({ customerInfo: emptyInfo, created: false })),
      logOut: jest.fn(async () => emptyInfo),
      getOfferings: jest.fn(async () => ({ current: null, all: {} })),
      purchasePackage: jest.fn(async () => ({ customerInfo: emptyInfo, productIdentifier: "" })),
      restorePurchases: jest.fn(async () => emptyInfo),
      getCustomerInfo: jest.fn(async () => emptyInfo),
      addCustomerInfoUpdateListener: jest.fn(),
    },
  };
});

// expo-font / expo-splash-screen: the root FontGate loads the brand typefaces
// and holds the splash until they land. Headless tests treat fonts as loaded
// instantly; FontGate.test.tsx overrides this per case.
jest.mock("expo-font", () => ({
  useFonts: () => [true, null],
  loadAsync: async () => {},
  isLoaded: () => true,
}));
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => true,
}));
