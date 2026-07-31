/**
 * `/auth/m` — where a tapped magic link lands.
 *
 * This path is advertised in the App Store association file (the AASA served
 * from shipaso.com lists `/auth/m`), so once #421 made iOS actually fetch that
 * file, universal links started handing off to the app. There was no route file
 * here, so expo-router rendered "Unmatched Route / Page could not be found."
 * over a link that had, in fact, worked.
 *
 * Auth is NOT handled here. AuthProvider captures the token from
 * `Linking.getInitialURL()` and the `url` event, independent of routing —
 * exchanging it again on this screen would risk spending a single-use token
 * twice. This screen's whole job is to be honest about what is happening while
 * that runs, and to route onward when it resolves.
 *
 * Mirrors the web page at the same path (docs/landing/auth/m/index.html), which
 * says "Signing you in…" for the same reason.
 */
import React from "react";
import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../src/auth/AuthProvider.js";
import { Screen, AppText, Centered } from "../../src/components/primitives.js";

export default function AuthLanding() {
  const { status } = useAuth();

  // Resolved: into the app.
  if (status === "authed") return <Redirect href="/(app)" />;

  // An expired or already-used link resolves to unauthed. Send it to login
  // rather than leaving it on a spinner — AuthProvider deliberately flips to
  // unauthed instead of stranding the UI on "loading", and this honours that.
  if (status === "unauthed") return <Redirect href="/(public)/login" />;

  return (
    <Screen>
      <Stack.Screen options={{ title: "Signing in", headerShown: false }} />
      <Centered>
        <AppText kind="title">Signing you in…</AppText>
        <AppText kind="dim">One moment while we finish opening your session.</AppText>
      </Centered>
    </Screen>
  );
}
