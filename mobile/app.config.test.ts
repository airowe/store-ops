import config, { APP_IDENTIFIER, ASSOCIATED_HOST } from "./app.config.js";

describe("app.config (ship readiness)", () => {
  it("iOS bundle id, Android package, and the associated domain are consistent", () => {
    expect(config.ios?.bundleIdentifier).toBe(APP_IDENTIFIER);
    expect(config.android?.package).toBe(APP_IDENTIFIER);
    expect(config.ios?.associatedDomains).toContain(`applinks:${ASSOCIATED_HOST}`);
    const filter = config.android?.intentFilters?.[0];
    expect(filter?.data).toEqual([{ scheme: "https", host: ASSOCIATED_HOST }]);
    expect(filter?.autoVerify).toBe(true);
  });

  it("ships the deep-link scheme + the apiBase the client reads", () => {
    expect(config.scheme).toBe("shipaso");
    expect((config.extra as { apiBase?: string }).apiBase).toMatch(/^https:\/\//);
  });

  it("declares the push permission + notifications plugin", () => {
    expect(config.android?.permissions).toContain("POST_NOTIFICATIONS");
    expect(config.plugins).toContain("expo-notifications");
    expect(config.plugins).toContain("expo-router");
    expect(config.plugins).toContain("expo-secure-store");
  });

  it("has a runtimeVersion policy (OTA safety)", () => {
    expect(config.runtimeVersion).toEqual({ policy: "appVersion" });
  });
});
