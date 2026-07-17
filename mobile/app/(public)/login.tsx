/**
 * Login — passwordless magic link. Enter an email → `POST /auth/request` (always
 * "we sent it", never leaking whether the account exists) → the emailed link
 * opens the app and AuthProvider exchanges it for a session token. No password,
 * no SSO. A pasted-token affordance helps dev/testing before the universal-link
 * association files are live.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useAuth } from "../../src/auth/AuthProvider.js";
import { Screen, AppText, Button, Card } from "../../src/components/primitives.js";
import { TextField } from "../../src/components/TextField.js";

export default function Login() {
  const { status, requestLink, completeMagicLink } = useAuth();
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
        <AppText kind="lead">Try it free — no signup</AppText>
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
            {error ? <AppText kind="dim" style={{ color: "#f87171" }}>{error}</AppText> : null}
            <Button label="Send magic link" onPress={() => void send()} loading={busy} disabled={!valid} testID="send-link" />
          </>
        )}
      </Card>

      <PasteTokenCard onPaste={(t) => void completeMagicLink(t)} />
    </Screen>
  );
}

/** Dev/testing affordance: paste a magic token directly (used until the
 *  universal-link association files are live). Honest about what it is. */
function PasteTokenCard({ onPaste }: { onPaste: (token: string) => void }) {
  const [token, setToken] = useState("");
  return (
    <Card>
      <AppText kind="dim">Have a sign-in token? (dev)</AppText>
      <TextField
        testID="token-input"
        value={token}
        onChangeText={setToken}
        placeholder="Paste magic-link token"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button label="Continue" variant="ghost" onPress={() => token.trim() && onPaste(token.trim())} disabled={!token.trim()} />
    </Card>
  );
}
