import { describe, expect, it, vi } from "vitest";
import { loadStoredAscForApp } from "./ascCredentials.js";

/**
 * #374 — an ASC API key is team-scoped, so a key saved once on the account
 * serves every app. The per-app row still wins; the account row is only
 * consulted when the app has none.
 */
const APP = { plaintext: "-----BEGIN app key-----", meta: { keyId: "APP1", issuerId: "iss" } };
const ACCOUNT = { plaintext: "-----BEGIN account key-----", meta: { keyId: "ACC1", issuerId: "iss" } };

describe("loadStoredAscForApp", () => {
  it("returns the app's own key and never consults the account when one exists", async () => {
    const loadAccount = vi.fn(async () => ACCOUNT);
    expect(await loadStoredAscForApp(async () => APP, loadAccount)).toBe(APP);
    expect(loadAccount).not.toHaveBeenCalled();
  });
  it("falls back to the account key when the app has none", async () => {
    expect(await loadStoredAscForApp(async () => null, async () => ACCOUNT)).toBe(ACCOUNT);
  });
  it("is null when neither exists, so the caller's 400/404 semantics are unchanged", async () => {
    expect(await loadStoredAscForApp(async () => null, async () => null)).toBeNull();
  });
});
