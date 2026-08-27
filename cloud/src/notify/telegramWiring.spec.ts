/**
 * Is Telegram actually WIRED, and does it degrade honestly when it is not
 * configured?
 *
 * The failure this guards against is the one migration 0013 already hit in this
 * repo: a capability that ships, is never connected, and passes every test that
 * only exercises the piece in isolation. `deliverersForEnv` is where the
 * connection either exists or does not.
 */
import { describe, expect, it } from "vitest";
import { deliverersForEnv } from "./forEnv.js";
import type { Env } from "../index.js";

const base = { APP_ENV: "test", SESSION_SECRET: "s" } as unknown as Env;

describe("deliverersForEnv", () => {
  it("always offers email", () => {
    expect(deliverersForEnv(base).map((d) => d.channel)).toContain("email");
  });

  it("offers Telegram when a bot token is configured", () => {
    const env = { ...base, TELEGRAM_BOT_TOKEN: "123:ABC" } as unknown as Env;
    expect(deliverersForEnv(env).map((d) => d.channel)).toContain("telegram");
  });

  it("does NOT offer Telegram without a token — an unconfigured channel is absent, not broken", () => {
    // deliverAll reports a destination with no transport as a config bug. That
    // is the honest outcome for a Telegram address on an env with no bot: it is
    // surfaced, never silently counted as delivered.
    expect(deliverersForEnv(base).map((d) => d.channel)).not.toContain("telegram");
  });

  it("treats a blank token as no token rather than building a doomed transport", () => {
    const env = { ...base, TELEGRAM_BOT_TOKEN: "   " } as unknown as Env;
    expect(deliverersForEnv(env).map((d) => d.channel)).not.toContain("telegram");
  });
});
