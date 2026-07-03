/**
 * buildMagicLink — the email URL builder. Default is the worker's /auth/callback
 * (unchanged web flow); MAGIC_LINK_BASE opts into the universal-link /auth/m path
 * that opens the mobile app. Token is always URL-encoded.
 */
import { describe, expect, it } from "vitest";
import { buildMagicLink } from "./index.js";
import type { Env } from "../index.js";

const ORIGIN = "https://api.shipaso.com";

describe("buildMagicLink", () => {
  it("defaults to the worker /auth/callback when MAGIC_LINK_BASE is unset (web flow unchanged)", () => {
    const env = { APP_ENV: "demo" } as Env;
    expect(buildMagicLink(env, ORIGIN, "tok.abc")).toBe("https://api.shipaso.com/auth/callback?token=tok.abc");
  });

  it("uses the universal-link /auth/m path when MAGIC_LINK_BASE is set", () => {
    const env = { APP_ENV: "demo", MAGIC_LINK_BASE: "https://shipaso.com" } as Env;
    expect(buildMagicLink(env, ORIGIN, "tok.abc")).toBe("https://shipaso.com/auth/m?token=tok.abc");
  });

  it("strips a trailing slash on MAGIC_LINK_BASE (no double slash)", () => {
    const env = { APP_ENV: "demo", MAGIC_LINK_BASE: "https://shipaso.com/" } as Env;
    expect(buildMagicLink(env, ORIGIN, "t")).toBe("https://shipaso.com/auth/m?token=t");
  });

  it("URL-encodes the token in both modes", () => {
    const raw = "a+b/c=d";
    const enc = encodeURIComponent(raw);
    expect(buildMagicLink({ APP_ENV: "demo" } as Env, ORIGIN, raw)).toContain(`token=${enc}`);
    expect(buildMagicLink({ APP_ENV: "demo", MAGIC_LINK_BASE: "https://shipaso.com" } as Env, ORIGIN, raw)).toContain(`token=${enc}`);
  });
});
