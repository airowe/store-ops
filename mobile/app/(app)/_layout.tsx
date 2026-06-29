/**
 * Authed route group — the dashboard + detail screens. Guards on auth state: a
 * `loading` boot shows a spinner; `unauthed` redirects to the public login;
 * `authed` renders the stack. Mirrors the web SPA's logged-in vs login split.
 */
import React from "react";
import { Redirect, Stack } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider.js";
import { Centered } from "../../src/components/primitives.js";
import { palette } from "../../src/theme/index.js";

export default function AppLayout() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <Centered>
        <ActivityIndicator color={palette.signal} />
      </Centered>
    );
  }
  if (status === "unauthed") {
    return <Redirect href="/(public)/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.bg },
        headerTintColor: palette.ink,
        contentStyle: { backgroundColor: palette.bg },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "ShipASO" }} />
    </Stack>
  );
}
