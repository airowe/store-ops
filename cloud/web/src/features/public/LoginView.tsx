/**
 * Login — magic-link sign-in. Email → POST /auth/request → "check your email".
 * Honest: no password, and we only claim "sent" when the request succeeds.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { authRequest } from "@shipaso/api";

export function LoginView({ client }: { client: ApiClient }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const req = useMutation({ mutationFn: (e: string) => authRequest(client, e), onSuccess: () => setSent(true) });
  const valid = /\S+@\S+\.\S+/.test(email.trim());

  if (sent) {
    return (
      <section>
        <h1>Check your email</h1>
        <p className="muted" data-testid="sent">
          We sent a one-time sign-in link to <b>{email.trim()}</b>. No password — click the link to continue.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1>Sign in</h1>
      <p className="muted">We email you a one-time link — no password. Then your connected apps load automatically.</p>
      <div style={{ display: "flex", gap: 8, maxWidth: 420, marginTop: 8 }}>
        <input
          className="txt"
          data-testid="email"
          type="email"
          value={email}
          placeholder="you@example.com"
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="button" className="btn primary" data-testid="send" disabled={!valid || req.isPending} onClick={() => req.mutate(email.trim())}>
          {req.isPending ? "Sending…" : "Send link"}
        </button>
      </div>
      {req.isError ? <p className="muted" style={{ color: "var(--bad)" }}>Couldn’t send the link — try again.</p> : null}
    </section>
  );
}
