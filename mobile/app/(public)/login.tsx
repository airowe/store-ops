/**
 * Login — passwordless magic link. Enter an email → `POST /auth/request` (always
 * "we sent it", never leaking whether the account exists) → the emailed link
 * opens the app and AuthProvider exchanges it for a session token. No password,
 * no SSO. The pasted-token card is the no-email path: App Review signs in with a
 * long-lived token from the review notes (Guideline 2.1(a)), and it doubles as
 * the dev/testing route.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useAuth } from "../../src/auth/AuthProvider.js";
import { Screen, AppText, Button, Card } from "../../src/components/primitives.js";
import { TextField } from "../../src/components/TextField.js";
import { usePalette } from "../../src/theme/index.js";

export default function Login() {
  const { status, requestLink, completeMagicLink } = useAuth();
  const palette = usePalette();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /\S+@\S+\.\S+/.test(email.trim());

  // The `(app)` guard redirects unauthed → here; this is the reverse edge. Auth
  // can complete while this screen is up (pasted token, or a magic deep link
  // arriving in the foreground), and nothing else navigates away from it.
  if (status === "authed") return <Redirect href="/(app)" />;

  async function send() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await requestLink(email.trim().toLowerCase());
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not send the link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 6, marginTop: 48 }}>
        <AppText kind="display">ShipASO</AppText>
        <AppText kind="dim">Honest ASO. Real numbers or an explicit “unmeasured” — never a guess.</AppText>
      </View>

      {/* Try-before-signup: the free audit needs no account. Surfaced up top so a
          logged-out visitor (and App Review) reaches the real value without a
          sign-in wall — mirrors the web landing. */}
      <Card>
        {/* No price language (Guideline 2.3.7) — see preview.tsx. Worded
            differently from the body line below so the card does not say
            "audit any listing" twice. */}
        <AppText kind="lead">Start with any listing — no signup</AppText>
        <AppText kind="dim">Audit any App Store listing on real keyword data. Sign in only to run the fix.</AppText>
        <Button label="Audit any listing" testID="audit-free" onPress={() => router.push("/(public)/preview")} />
      </Card>

      <Card>
        <AppText kind="lead">Sign in</AppText>
        {sent ? (
          <>
            <AppText kind="body">
              If {email.trim().toLowerCase()} has an account, a sign-in link is on its way. Open it on this device.
            </AppText>
            <Button label="Use a different email" variant="ghost" onPress={() => setSent(false)} />
          </>
        ) : (
          <>
            <TextField
              testID="email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => void send()}
            />
            {error ? <AppText kind="dim" style={{ color: palette.bad }}>{error}</AppText> : null}
            <Button label="Send magic link" onPress={() => void send()} loading={busy} disabled={!valid} testID="send-link" />
          </>
        )}
      </Card>

      <PasteTokenCard onPaste={(t) => void completeMagicLink(t)} />
    </Screen>
  );
}

/**
 * Paste-a-token sign-in. This is NOT only a dev affordance — it is the path App
 * Review uses (Guideline 2.1(a), 0.1.1): sign-in is passwordless, a reviewer
 * cannot open the mailbox our magic link goes to, and magic tokens expire in 15
 * minutes, so the review notes carry a long-lived review token to paste here.
 * Labelling this "(dev)" is what led the 0.1.1 reviewer to ignore it and report
 * the app as unreachable — so the copy names the real audience.
 */
function PasteTokenCard({ onPaste }: { onPaste: (token: string) => void }) {
  const [token, setToken] = useState("");
  return (
    <Card>
      <AppText kind="lead">Have a sign-in token?</AppText>
      <AppText kind="dim">
        App Review: paste the token from the review notes here to sign in without email.
      </AppText>
      <TextField
        testID="token-input"
        value={token}
        onChangeText={setToken}
        placeholder="Paste sign-in token"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button label="Continue" variant="ghost" onPress={() => token.trim() && onPaste(token.trim())} disabled={!token.trim()} />
    </Card>
  );
}
