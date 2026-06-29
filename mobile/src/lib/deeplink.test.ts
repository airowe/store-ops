import { routeForDeepLink, routeForNotificationData } from "./deeplink.js";

describe("routeForDeepLink", () => {
  it("maps run + app links (universal + custom scheme)", () => {
    expect(routeForDeepLink("https://shipaso.com/runs/r123")).toBe("/(app)/runs/r123");
    expect(routeForDeepLink("shipaso://apps/a1")).toBe("/(app)/apps/a1");
    expect(routeForDeepLink("https://shipaso.com/apps/a1/war-room")).toBe("/(app)/war-room/a1");
  });

  it("maps portfolio + proof", () => {
    expect(routeForDeepLink("https://shipaso.com/portfolio")).toBe("/(app)/portfolio");
    expect(routeForDeepLink("https://shipaso.com/proof")).toBe("/(public)/proof");
  });

  it("ignores the magic-link path (handled by the session layer) and unknowns", () => {
    expect(routeForDeepLink("https://shipaso.com/auth/m?token=abc")).toBeNull();
    expect(routeForDeepLink("https://shipaso.com/")).toBeNull();
    expect(routeForDeepLink(null)).toBeNull();
  });

  it("strips query/hash and decodes the id", () => {
    expect(routeForDeepLink("https://shipaso.com/runs/r%201?x=1#y")).toBe("/(app)/runs/r 1");
  });
});

describe("routeForNotificationData", () => {
  it("prefers runId, then appId, then a url", () => {
    expect(routeForNotificationData({ runId: "r1" })).toBe("/(app)/runs/r1");
    expect(routeForNotificationData({ appId: "a1" })).toBe("/(app)/apps/a1");
    expect(routeForNotificationData({ url: "https://shipaso.com/apps/a2" })).toBe("/(app)/apps/a2");
    expect(routeForNotificationData(undefined)).toBeNull();
  });
});
