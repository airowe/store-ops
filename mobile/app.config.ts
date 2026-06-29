import type { ExpoConfig } from "expo/config";

/**
 * Expo app config. The API base mirrors `cloud/public/config.js`
 * (`https://api.shipaso.com`) and is read at runtime via
 * `expo-constants` → `Constants.expoConfig.extra.apiBase`.
 *
 * The bundle identifier / package name MUST match the universal-link
 * association files at `cloud/public/.well-known/*` (filled with the real Team
 * ID + signing fingerprint at Phase 6). Deep links use the `shipaso://` scheme
 * plus the `https://shipaso.com` associated domain.
 */
const API_BASE = process.env.SHIPASO_API_BASE ?? "https://api.shipaso.com";

const config: ExpoConfig = {
  name: "ShipASO",
  slug: "shipaso",
  scheme: "shipaso",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  ios: {
    bundleIdentifier: "com.shipaso.app",
    supportsTablet: true,
    associatedDomains: ["applinks:shipaso.com"],
  },
  android: {
    package: "com.shipaso.app",
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "shipaso.com" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: ["expo-router", "expo-secure-store", "expo-font", "expo-notifications"],
  experiments: { typedRoutes: true },
  extra: {
    apiBase: API_BASE,
  },
};

export default config;
