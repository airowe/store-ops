/**
 * Root layout — mounts the app-wide providers (theme + React Query for
 * server-state + the navigation Stack). `ThemeProvider` sits outermost so every
 * screen can read the live light/dark palette; the shell chrome (nav background,
 * status bar) tracks it too. Screen groups live under `(public)` (login/preview/
 * proof) and `(app)` (the authed dashboard + details).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/auth/AuthProvider.js";
import { NotificationsBridge } from "../src/notifications/NotificationsBridge.js";
import { ThemeProvider, usePalette, useThemeMode } from "../src/theme/index.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

/** The navigation shell — inside ThemeProvider so it can read the live palette. */
function AppShell() {
  const palette = usePalette();
  const { scheme } = useThemeMode();
  return (
    <>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.bg },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NotificationsBridge />
          <AppShell />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
