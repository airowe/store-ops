/**
 * Jest setup — mock the native modules the app touches so tests run headless
 * (no device). expo-secure-store is mocked with an in-memory store; the
 * credential tests assert that the credential value NEVER reaches it.
 */
import "@testing-library/react-native";

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

jest.mock("expo-linking", () => ({
  createURL: (path: string) => `shipaso://${path}`,
  parse: (url: string) => ({ queryParams: Object.fromEntries(new URL(url).searchParams) }),
  useURL: () => null,
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));
