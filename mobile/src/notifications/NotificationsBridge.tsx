/**
 * NotificationsBridge — mounts the push lifecycle: registers for push once the
 * user is authed (best-effort, degrades silently) and routes a notification tap
 * to the right screen. Renders nothing. Kept out of `_layout` so the native
 * wiring is isolated and the logic (register/handlers/deeplink) stays unit-tested.
 */
import { useEffect } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "../auth/AuthProvider.js";
import { registerForPush } from "./register.js";
import { handleNotificationResponse } from "./handlers.js";

export function NotificationsBridge() {
  const { status, client } = useAuth();
  const router = useRouter();

  // Register for push once authed (permission prompt happens here).
  useEffect(() => {
    if (status !== "authed") return;
    void registerForPush(client, {
      getPermissionsAsync: Notifications.getPermissionsAsync,
      requestPermissionsAsync: Notifications.requestPermissionsAsync,
      getExpoPushTokenAsync: () => Notifications.getExpoPushTokenAsync(),
    });
  }, [status, client]);

  // Route a tapped notification (cold start + while running).
  useEffect(() => {
    void Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) handleNotificationResponse(resp, (r) => router.push(r as never));
    });
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      handleNotificationResponse(resp, (r) => router.push(r as never));
    });
    return () => sub.remove();
  }, [router]);

  return null;
}
