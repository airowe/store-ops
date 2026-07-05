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

/** The identity that MUST match the .well-known association files + EAS submit. */
export const APP_IDENTIFIER = "com.shipaso.app";
export const ASSOCIATED_HOST = "shipaso.com";

const config: ExpoConfig = {
  name: "ShipASO",
  slug: "shipaso",
  scheme: "shipaso",
  version: "0.1.0",
  // runtimeVersion ties OTA updates to a native build; "appVersion" policy bumps
  // it with `version` so an incompatible JS bundle is never served to an old app.
  runtimeVersion: { policy: "appVersion" },
  // "default" lets the iPad rotate to landscape (the responsive layout uses the
  // extra width for multi-column card grids); phones still read fine either way.
  orientation: "default",
  userInterfaceStyle: "dark",
  backgroundColor: "#07090e",
  // The ship mark mirrors the web favicon (cloud/public/index.html).
  icon: "./assets/icon.png",
  assetBundlePatterns: ["**/*"],
  ios: {
    bundleIdentifier: APP_IDENTIFIER,
    buildNumber: "1",
    supportsTablet: true,
    associatedDomains: [`applinks:${ASSOCIATED_HOST}`],
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      // We never push to a live store and store no credentials on device; the
      // only data at rest is the session token in the Keychain.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: APP_IDENTIFIER,
    versionCode: 1,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#07090e" },
    permissions: ["POST_NOTIFICATIONS"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: ASSOCIATED_HOST }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  // splash + notification config moved into plugins with SDK 52+.
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#34d399" }],
    [
      "expo-splash-screen",
      { image: "./assets/splash.png", resizeMode: "contain", backgroundColor: "#07090e" },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiBase: API_BASE,
    // @airowe/shipaso on expo.dev (created via `eas init`).
    eas: { projectId: process.env.EAS_PROJECT_ID ?? "8eb364b9-0afc-49af-8393-5feccc7111c3" },
  },
};

export default config;
