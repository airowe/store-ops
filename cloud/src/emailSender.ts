/**
 * Pick the email transport for an environment. Preference order:
 *   RESEND_API_KEY (+ RESEND_FROM) → Resend (the configured provider)
 *   otherwise                      → ConsoleEmailSender (logs; no vendor needed)
 * Shared so the API (magic link) and the cron (weekly digest) select identically.
 */
import { ConsoleEmailSender, type EmailSender, ResendEmailSender } from "./auth.js";
import type { Env } from "./index.js";

export function emailSenderForEnv(env: Env): EmailSender {
  if (env.RESEND_API_KEY && env.RESEND_FROM) {
    return new ResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM });
  }
  return new ConsoleEmailSender();
}
