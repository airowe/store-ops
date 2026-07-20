/**
 * Settings — the app's first settings surface (comms-prefs Phase 4).
 *
 * Communications: run-ready push (server pref + registration awareness), weekly
 * digest, rank-check cadence — plus sign-out (moved here from the dashboard),
 * which unregisters this device's push token BEFORE dropping the session
 * (best-effort; never blocks sign-out).
 *
 * Honesty rules, verbatim in the copy: prefs change what gets SENT, never what
 * the agent does. A denied OS permission shows an honest off-state pointing at
 * OS Settings — never a lying "on".
 */
import React, { useState } from "react";
import { Stack } from "expo-router";
import { View } from "react-native";
import * as Notifications from "expo-notifications";
import { useAuth } from "../../src/auth/AuthProvider.js";
import { setNotifications, setRankCadence } from "../../src/api/endpoints.js";
import { registerForPush, getLastKnownPushToken } from "../../src/notifications/register.js";
import { signOutWithCleanup } from "../../src/lib/signout.js";
import { StoredKeysCard } from "../../src/components/StoredKeysCard.js";
import { GithubCard } from "../../src/components/GithubCard.js";
import { Screen, AppText, Button, Card } from "../../src/components/primitives.js";
import { spacing, usePalette, useThemeMode, type ThemeMode } from "../../src/theme/index.js";

export default function Settings() {
  const { me, client, signOut } = useAuth();
  const palette = usePalette();
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();

  const [digestOn, setDigestOn] = useState((me?.email_digest ?? "weekly") === "weekly");
  const [pushOn, setPushOn] = useState(me?.push_run_ready ?? true);
  const [cadence, setCadence] = useState(me?.rank_cadence ?? "weekly");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function toggleDigest() {
    setBusy("digest");
    setNote(null);
    try {
      const next = digestOn ? "off" : "weekly";
      const r = await setNotifications(client, { email_digest: next });
      setDigestOn(r.email_digest === "weekly");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn’t update the digest setting.");
    } finally {
      setBusy(null);
    }
  }

  async function togglePush() {
    setBusy("push");
    setNote(null);
    try {
      if (pushOn) {
        // OFF: server gate only — the token stays registered so ON is instant.
        const r = await setNotifications(client, { push_run_ready: false });
        setPushOn(r.push_run_ready);
      } else {
        // ON: permission (prompt if needed) → register → server pref.
        const reg = await registerForPush(client, {
          getPermissionsAsync: Notifications.getPermissionsAsync,
          requestPermissionsAsync: Notifications.requestPermissionsAsync,
          getExpoPushTokenAsync: () => Notifications.getExpoPushTokenAsync(),
        });
        if (!reg.ok) {
          // honest off-state — never a lying "on".
          setNote(
            reg.reason === "denied"
              ? "Notifications are blocked for ShipASO in your OS Settings — enable them there, then try again."
              : "Couldn’t register this device for push right now.",
          );
          return;
        }
        const r = await setNotifications(client, { push_run_ready: true });
        setPushOn(r.push_run_ready);
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn’t update the push setting.");
    } finally {
      setBusy(null);
    }
  }

  async function pickCadence(next: "weekly" | "daily") {
    if (next === cadence) return;
    setBusy("cadence");
    setNote(null);
    try {
      const r = await setRankCadence(client, next);
      setCadence(r.rank_cadence);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn’t update the cadence.");
    } finally {
      setBusy(null);
    }
  }

  async function doSignOut() {
    setBusy("signout");
    await signOutWithCleanup({
      client,
      getKnownToken: getLastKnownPushToken,
      fetchFreshToken: async () => {
        try {
          return (await Notifications.getExpoPushTokenAsync()).data;
        } catch {
          return null;
        }
      },
      signOut,
    });
  }

  return (
    <Screen topInset={false}>
      <Stack.Screen options={{ title: "Settings", headerShown: true }} />

      <Card>
        <AppText kind="lead">Communications</AppText>
        <AppText kind="micro">These change what we send — never what the agent does.</AppText>

        <SettingRow
          title="Run-ready push"
          detail={pushOn ? "We’ll notify this account when a run awaits your approval." : "ShipASO stops sending; your device stays registered. Runs still open."}
          action={<Button testID="push-toggle" label={pushOn ? "On" : "Off"} variant="ghost" onPress={() => void togglePush()} loading={busy === "push"} />}
        />

        <SettingRow
          title="Weekly digest email"
          detail="Stops the weekly digest for every app on this account — the agent keeps working and runs keep opening."
          action={<Button testID="digest-toggle" label={digestOn ? "On" : "Off"} variant="ghost" onPress={() => void toggleDigest()} loading={busy === "digest"} />}
        />

        <SettingRow
          title="Rank checks"
          detail="How often we snapshot your keyword ranks. Data collection — not email frequency."
          action={
            <View style={{ flexDirection: "row", gap: spacing.xs }}>
              <Button testID="cadence-weekly" label="Weekly" variant={cadence === "weekly" ? "primary" : "ghost"} onPress={() => void pickCadence("weekly")} disabled={busy === "cadence"} />
              <Button testID="cadence-daily" label="Daily" variant={cadence === "daily" ? "primary" : "ghost"} onPress={() => void pickCadence("daily")} disabled={busy === "cadence"} />
            </View>
          }
        />

        {note ? <AppText kind="dim" style={{ color: palette.warn }}>{note}</AppText> : null}
      </Card>

      <Card>
        <AppText kind="lead">Appearance</AppText>
        <AppText kind="micro">Theme for this device. “System” follows your OS light/dark setting.</AppText>
        <View style={{ flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm }}>
          {(["system", "light", "dark"] as ThemeMode[]).map((m) => (
            <Button
              key={m}
              testID={`theme-${m}`}
              label={m[0]!.toUpperCase() + m.slice(1)}
              variant={themeMode === m ? "primary" : "ghost"}
              onPress={() => setThemeMode(m)}
            />
          ))}
        </View>
      </Card>

      <StoredKeysCard client={client} />

      <GithubCard client={client} />

      <Card>
        <AppText kind="lead">Account</AppText>
        {me?.email ? <AppText kind="micro">{me.email}</AppText> : null}
        <Button testID="sign-out" label="Sign out" variant="ghost" onPress={() => void doSignOut()} loading={busy === "signout"} />
      </Card>
    </Screen>
  );
}

function SettingRow({ title, detail, action }: { title: string; detail: string; action: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <AppText kind="body">{title}</AppText>
        <AppText kind="micro">{detail}</AppText>
      </View>
      {action}
    </View>
  );
}
