/**
 * Public route group — screens reachable while logged out (login, preview,
 * proof). No auth guard here.
 *
 * Headers are hidden by default (login and preview draw their own hero) and
 * THEMED for the screens that turn them on (proof): the defaults live here, on
 * the Stack, exactly as the (app) group does it — set only from inside a
 * screen via <Stack.Screen options>, the header background did not repaint on
 * iOS and the default white bar showed over the dark screen.
 */
import { Stack } from "expo-router";
import { typeface, usePalette } from "../../src/theme/index.js";

export default function PublicLayout() {
  const palette = usePalette();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: palette.bg },
        headerTintColor: palette.ink,
        headerTitleStyle: { fontFamily: typeface.title, color: palette.ink },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: palette.bg },
      }}
    />
  );
}
