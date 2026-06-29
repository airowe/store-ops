/**
 * Deep-link routing — map an incoming URL (universal link or `shipaso://`) to an
 * Expo Router path. Auth magic links are handled separately by the session layer
 * (`extractMagicToken`); here we resolve content links: `apps/:id`, `runs/:id`,
 * `portfolio`, `proof`. Pure + testable; the router just consumes the result.
 */

export type RouteTarget = string | null;

/** Pull the path portion out of any URL form (https with a host, or a custom
 *  scheme where the first segment is the path, e.g. shipaso://apps/123). */
function pathOf(url: string): string {
  const m = url.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
  const scheme = m ? m[1]!.toLowerCase() : "";
  const rest = m ? m[2]! : url;
  let path: string;
  if (scheme === "http" || scheme === "https") {
    // strip the host: path is from the first slash after the host.
    const slash = rest.indexOf("/");
    path = slash >= 0 ? rest.slice(slash) : "/";
  } else {
    // custom scheme (shipaso://apps/123) — the whole remainder IS the path.
    path = "/" + rest.replace(/^\/+/, "");
  }
  return path.split("?")[0]!.split("#")[0]!;
}

/**
 * Resolve a deep link to an in-app route, or null when it isn't a content link we
 * route (e.g. the magic-link `auth/m`, which the session layer consumes instead).
 */
export function routeForDeepLink(url: string | null | undefined): RouteTarget {
  if (!url) return null;
  const path = pathOf(url);
  let m: RegExpMatchArray | null;

  if ((m = path.match(/\/runs\/([^/]+)\/?$/))) return `/(app)/runs/${decodeURIComponent(m[1]!)}`;
  if ((m = path.match(/\/apps\/([^/]+)\/war-room\/?$/))) return `/(app)/war-room/${decodeURIComponent(m[1]!)}`;
  if ((m = path.match(/\/apps\/([^/]+)\/?$/))) return `/(app)/apps/${decodeURIComponent(m[1]!)}`;
  if (/\/portfolio\/?$/.test(path)) return "/(app)/portfolio";
  if (/\/proof\/?$/.test(path)) return "/(public)/proof";
  return null;
}

/** Resolve a notification's data payload to a route (push tap → screen). */
export function routeForNotificationData(data: Record<string, unknown> | undefined): RouteTarget {
  if (!data) return null;
  if (typeof data.runId === "string") return `/(app)/runs/${data.runId}`;
  if (typeof data.appId === "string") return `/(app)/apps/${data.appId}`;
  if (typeof data.url === "string") return routeForDeepLink(data.url);
  return null;
}
