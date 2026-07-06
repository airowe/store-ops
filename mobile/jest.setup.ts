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
}));
