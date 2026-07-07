export const NEW_APP_ENTRY: string;
export function extractOwnedArray(src: string): string | null;
export function isNavigationRequest(method: string, pathname: string, accept?: string): boolean;
export function serveDecision(
  req: { method: string; pathname: string; accept?: string },
  resolveSurface: (pathname: string) => "web" | "legacy",
): "rewrite-web" | "passthrough";
