/**
 * Pick the email transport for an environment. Preference order:
 *   BREVO_API_KEY (+ BREVO_FROM)   → Brevo (the configured provider)
 *   RESEND_API_KEY (+ RESEND_FROM) → Resend (legacy/fallback)
 *   otherwise                      → ConsoleEmailSender (logs; no vendor needed)
 * Shared so the API (magic link) and the cron (weekly digest) select identically.
 */
import {
  BrevoEmailSender,
  ConsoleEmailSender,
  type EmailSender,
  ResendEmailSender,
} from "./auth.js";
import type { Env } from "./index.js";

export function emailSenderForEnv(env: Env): EmailSender {
  if (env.BREVO_API_KEY && env.BREVO_FROM) {
    return new BrevoEmailSender({ apiKey: env.BREVO_API_KEY, from: env.BREVO_FROM });
  }
  if (env.RESEND_API_KEY && env.RESEND_FROM) {
    return new ResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM });
  }
  return new ConsoleEmailSender();
}
