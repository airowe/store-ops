/**
 * Notification tap handling — turn a tapped notification into a navigation. The
 * pure mapping lives in `lib/deeplink` (routeForNotificationData); this wires it
 * to a router push and is the seam the root layout subscribes to.
 */
import { routeForNotificationData, type RouteTarget } from "../lib/deeplink.js";

export type NotificationResponseLike = {
  notification: { request: { content: { data?: Record<string, unknown> } } };
};

/** Compute the route a tapped notification should navigate to (or null). */
export function targetForResponse(response: NotificationResponseLike): RouteTarget {
  return routeForNotificationData(response.notification?.request?.content?.data);
}

/** Navigate in response to a tap, if it maps to a route. */
export function handleNotificationResponse(
  response: NotificationResponseLike,
  navigate: (route: string) => void,
): void {
  const target = targetForResponse(response);
  if (target) navigate(target);
}
