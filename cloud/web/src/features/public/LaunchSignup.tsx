/**
 * Launch-list email capture for the landing page. The OSS plugin is live; this
 * collects emails for Autopilot (the hosted $19/mo tier) news + the launch.
 *
 * Posts to /subscribe, which records best-effort and idempotently (INSERT OR
 * IGNORE) and never reveals failure. So the UI thanks the visitor on BOTH
 * success and error — a launch-list signup should never show a red error, and
 * the server has already done its best either way. Honest: we don't claim more
 * than "thanks, we'll email you."
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { subscribe } from "@shipaso/api";

export function LaunchSignup({ client }: { client: ApiClient }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const valid = /\S+@\S+\.\S+/.test(email.trim());

  const mut = useMutation({
    mutationFn: (e: string) => subscribe(client, e),
    // Best-effort + idempotent server → confirm on success OR error.
    onSettled: () => setDone(true),
  });

  if (done) {
    return (
      <div className="card" data-testid="launch-done">
        <b>Thanks — you're on the list.</b>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          We'll email you Autopilot news and the launch. No spam.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <b>Get launch updates</b>
      <p className="muted" style={{ margin: "6px 0 10px" }}>
        The OSS plugin is live now. Drop your email for Autopilot news and the launch.
      </p>
      <div style={{ display: "flex", gap: 8, maxWidth: 420 }}>
        <input
          className="txt"
          data-testid="launch-email"
          type="email"
          value={email}
          placeholder="you@example.com"
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="button"
          className="btn primary"
          data-testid="launch-submit"
          disabled={!valid || mut.isPending}
          onClick={() => mut.mutate(email.trim())}
        >
          {mut.isPending ? "Adding…" : "Notify me"}
        </button>
      </div>
    </div>
  );
}
