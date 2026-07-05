import * as fs from "node:fs";
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
    const pluginNames = (config.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(pluginNames).toContain("expo-notifications");
    expect(pluginNames).toContain("expo-router");
    expect(pluginNames).toContain("expo-secure-store");
    expect(pluginNames).toContain("expo-splash-screen");
  });

  it("has a runtimeVersion policy (OTA safety)", () => {
    expect(config.runtimeVersion).toEqual({ policy: "appVersion" });
  });

  it("references binary assets that exist on disk (EAS build would fail without them)", () => {
    const pluginOpts = (name: string): Record<string, unknown> => {
      const entry = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === name);
      return (Array.isArray(entry) ? (entry[1] as Record<string, unknown>) : undefined) ?? {};
    };
    for (const p of [
      config.icon,
      pluginOpts("expo-splash-screen").image,
      config.android?.adaptiveIcon?.foregroundImage,
      pluginOpts("expo-notifications").icon,
    ]) {
      expect(p).toBeDefined();
      expect(fs.existsSync(p as string)).toBe(true);
    }
  });
});
