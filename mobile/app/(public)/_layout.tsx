/**
 * Public route group — screens reachable while logged out (login, preview,
 * proof). No auth guard here.
 */
import { Stack } from "expo-router";

export default function PublicLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
