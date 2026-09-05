/**
 * Holds the splash screen until the brand typefaces are loaded, so no screen
 * paints in the system font for a frame and then jumps to Fraunces.
 *
 * If loading FAILS, the app still renders: React Native falls back to the
 * system font for an unknown family, which is a degraded launch — a blank app
 * would be an outage. FontGate.test.tsx pins both behaviours.
 */
import React, { useEffect } from "react";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { fontAssets } from "./fonts.js";

// Keep the native splash up until we decide to hide it (best effort; the call
// rejects harmlessly when there is no splash, e.g. under tests).
SplashScreen.preventAutoHideAsync().catch(() => {});

export function FontGate({ children }: { children: React.ReactNode }) {
  const [loaded, error] = useFonts(fontAssets);
  const ready = loaded || error !== null;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;
  return <>{children}</>;
}
