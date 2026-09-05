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
/**
 * The dashboard subdomain, which is what our EMAILS actually link to
 * (`DASHBOARD_ORIGIN ?? "https://app.shipaso.com"`, cloud/src/api/index.ts).
 *
 * iOS matches universal links on the EXACT host and implies no wildcard, so
 * associating only the apex meant a tapped digest link opened Safari and never
 * offered the app — the same Guideline 2.1(a) dead end that rejected 0.1.0.
 * `shipaso.com/dashboard` 404s; the content lives only here. Both hosts serve a
 * valid AASA with `content-type: application/json`.
 */
export const DASHBOARD_HOST = "app.shipaso.com";
/** Every host whose https links must open the app rather than the browser. */
export const LINKED_HOSTS = [ASSOCIATED_HOST, DASHBOARD_HOST] as const;

const config: ExpoConfig = {
  name: "ShipASO",
  slug: "shipaso",
  scheme: "shipaso",
  version: "0.1.2",
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
    associatedDomains: LINKED_HOSTS.map((h) => `applinks:${h}`),
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
        data: LINKED_HOSTS.map((host) => ({ scheme: "https", host })),
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
      {
        // A TIGHT-CROPPED logo, not a full-screen canvas. splash.png is
        // 1284x2778 with the boat occupying ~39% of its width, and
        // `resizeMode: contain` fits that whole canvas into imageWidth — so the
        // baked-in padding was scaled down twice and the boat rendered tiny.
        // splash-icon.png is the same mark cropped square at 1024x1024.
        image: "./assets/splash-icon.png",
        // Explicit, because the default is ~200px on a ~1290px-wide screen.
        imageWidth: 320,
        resizeMode: "contain",
        backgroundColor: "#07090e",
      },
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
    // from a screen that sells a subscription, and 0.1.0 ate a 2.1(a) for a
    // legal link that 404'd — so `legalUrls()` renders NO control for an unset
    // URL rather than a broken one (#430).
    //
    // Both now default to real routes on the web app rather than "": /privacy
    // and /terms are registered in cloud/web/src/router.tsx. Note the apex
    // shipaso.com/terms and /privacy still 404 — the pages live on the app
    // subdomain, which is what ASC's Privacy Policy URL already points at. The
    // env vars stay as an override for a staging build.
    legal: {
      terms: process.env.LEGAL_TERMS_URL ?? "https://app.shipaso.com/terms",
      privacy: process.env.LEGAL_PRIVACY_URL ?? "https://app.shipaso.com/privacy",
    },
  },
};

export default config;
