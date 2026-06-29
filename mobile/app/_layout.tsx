/**
 * Root layout — mounts the app-wide providers (React Query for server-state +
 * the navigation Stack) and the dark theme background. Screen groups live under
 * `(public)` (login/preview/proof) and `(app)` (the authed dashboard + details);
 * the auth guard that routes between them lands with Phase 1's session work.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { palette } from "../src/theme/index.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.bg },
          headerTintColor: palette.ink,
          contentStyle: { backgroundColor: palette.bg },
          headerShadowVisible: false,
        }}
      />
    </QueryClientProvider>
  );
}
