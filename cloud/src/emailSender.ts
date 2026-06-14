/**
 * Pick the email transport for an environment. With RESEND_API_KEY (+
 * RESEND_FROM) set we deliver via Resend; otherwise the ConsoleEmailSender logs
 * the message, so both auth (magic link) and the cron (weekly digest) work with
 * no email vendor configured. Shared so the API and the cron select identically.
 */
import { ConsoleEmailSender, type EmailSender, ResendEmailSender } from "./auth.js";
import type { Env } from "./index.js";

export function emailSenderForEnv(env: Env): EmailSender {
  if (env.RESEND_API_KEY && env.RESEND_FROM) {
    return new ResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM });
  }
  return new ConsoleEmailSender();
}
