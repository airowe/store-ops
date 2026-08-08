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
  version: "0.1.1",
  // runtimeVersion ties OTA updates to a native build; "appVersion" policy bumps
  // it with `version` so an incompatible JS bundle is never served to an old app.
  runtimeVersion: { policy: "appVersion" },
  // "default" lets the iPad rotate to landscape (the responsive layout uses the
  // extra width for multi-column card grids); phones still read fine either way.
  orientation: "default",
  // "automatic" so iOS reports the real device scheme to `useColorScheme()`,
  // which is what ThemeProvider resolves `mode: "system"` against. Forcing
  // "dark" here was protective while components hardcoded the dark palette
  // (#353) — honouring the system setting then would have produced a light
  // shell full of dark colours. Now that every component reads the live
  // palette, this is the only thing left preventing light mode.
  //
  // `ios/` is checked in, so this does NOT regenerate Info.plist: the native
  // UIUserInterfaceStyle key must be changed in lockstep or the binary keeps
  // forcing dark regardless of what this says.
  userInterfaceStyle: "automatic",
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
    // NOTE: react-native-purchases is deliberately NOT listed here. It ships no
    // `app.plugin.js`, so naming it makes Expo load the package's main entry as
    // a config plugin and throw `PluginError: Unexpected token 'typeof'` —
    // `expo config --type prebuild` exits 1, which breaks `fastlane build` at
    // the prebuild step. The SDK autolinks natively; no plugin entry is needed.
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
    // RevenueCat PUBLIC SDK keys per platform (not secrets). Empty until the
    // RevenueCat project exists (Workstream A) → the paywall shows an
    // "unavailable" state and the SDK stays unconfigured, rather than crashing.
    revenueCat: {
      ios: process.env.REVENUECAT_IOS_KEY ?? "",
      android: process.env.REVENUECAT_ANDROID_KEY ?? "",
    },
    // Terms of Use (EULA) + privacy policy. Apple requires both to be reachable
    // from a screen that sells a subscription. Empty until the pages are
    // published — neither URL exists on shipaso.com yet (both 404 today), and
    // shipping a link to a 404 from a purchase screen is its own rejection, so
    // the paywall renders no link rather than a broken one. See issue #430.
    legal: {
      terms: process.env.LEGAL_TERMS_URL ?? "",
      privacy: process.env.LEGAL_PRIVACY_URL ?? "",
    },
  },
};

export default config;
