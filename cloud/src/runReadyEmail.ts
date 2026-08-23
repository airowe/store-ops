/**
 * The "a run awaits your approval" email — the fallback for a user push cannot
 * reach.
 *
 * Push requires the mobile app plus granted permission. In production not one
 * real user had a device token (#494), so the notification half of "we watch,
 * we propose, you approve" reached nobody outside the owner's own devices.
 * Email is the channel every user has by definition: they signed in with it.
 *
 * Pure — subject/html/text only, no DB and no network, so the copy is testable
 * without a sender. The caller does the I/O and the preference gate.
 */

/** Escaped for HTML interpolation. App names come from the store, not from us. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type RunReadyInput = {
  appName: string;
  runUrl: string;
  /** Why the sweep opened this gate. Empty/absent → the email states no reason. */
  reasons?: readonly string[];
};

/**
 * Compose the message. Deliberately short: it exists to get the user to the
 * run, not to reproduce the dashboard in an inbox. The reasons are included
 * because a notification with no "why" is a nag — the user should be able to
 * decide whether it is worth opening from the email alone.
 */
export function runReadyMessage(input: RunReadyInput): {
  subject: string;
  html: string;
  text: string;
} {
  const name = input.appName.trim() || "your app";
  const reasons = (input.reasons ?? []).filter((r) => r.trim() !== "");

  const subject = `${name}: a change is ready for your approval`;

  const reasonLinesText = reasons.length
    ? `\nWhat the agent found:\n${reasons.map((r) => `  - ${r}`).join("\n")}\n`
    : "";
  const reasonLinesHtml = reasons.length
    ? `<p style="margin:16px 0 8px"><strong>What the agent found:</strong></p><ul style="margin:0 0 16px;padding-left:20px;color:#55606f">${reasons
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("")}</ul>`
    : "";

  const text =
    `ShipASO prepared a change for ${name} and it is waiting for you.\n` +
    reasonLinesText +
    `\nReview it here:\n${input.runUrl}\n\n` +
    `Nothing is pushed to the App Store or Google Play until you approve it, ` +
    `and approving is not shipping — submitting to the store stays your action, ` +
    `in your account.\n\n` +
    `--\nShipASO. Every number it shows is measured, or it is marked unmeasured ` +
    `— never a guess.`;

  const html =
    `<p>ShipASO prepared a change for <strong>${escapeHtml(name)}</strong> and it is waiting for you.</p>` +
    reasonLinesHtml +
    `<p><a href="${escapeHtml(input.runUrl)}">Review the proposed change</a></p>` +
    `<p style="color:#55606f;font-size:14px">Nothing is pushed to the App Store or Google Play until you approve it, and approving is not shipping — submitting to the store stays your action, in your account.</p>` +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">` +
    `<p style="color:#8a94a6;font-size:12px">ShipASO. Every number it shows is measured, or it is marked unmeasured — never a guess.</p>`;

  return { subject, html, text };
}
