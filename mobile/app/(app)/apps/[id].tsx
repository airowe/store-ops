/**
 * App detail — the app's identity, rank movement, and its run history. Tapping a
 * run opens the run detail ("money screen"). Read-only; honest movement (an
 * unchecked keyword stays "—", never a guessed number).
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../src/auth/AuthProvider.js";
import { auditPlay, getApp, getDeltas, getRanks, runAsc, verifyPlay } from "../../../src/api/endpoints.js";
import { RankMovementRow } from "../../../src/components/RankMovementRow.js";
import { CredentialSheet, type AscSubmit, type PlaySubmit } from "../../../src/components/CredentialSheet.js";
import { PlayAuditView } from "../../../src/components/PlayAuditView.js";
import { CompetitorsCard } from "../../../src/components/CompetitorsCard.js";
import { AgentTriggersCard } from "../../../src/components/AgentTriggersCard.js";
import { EmptyState } from "../../../src/components/EmptyState.js";
import { Screen, AppText, Button, Card, Centered } from "../../../src/components/primitives.js";
import { humanizeStatus, timeAgo } from "../../../src/lib/format.js";
import { shareWin } from "../../../src/lib/shareCard.js";
import { palette, spacing } from "../../../src/theme/index.js";
import type { PlayAudit } from "../../../src/types/api.js";

export default function AppDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client } = useAuth();
  const router = useRouter();
  const now = Date.now();

  const app = useQuery({ queryKey: ["app", id], queryFn: () => getApp(client, id!), enabled: !!id });
  const deltas = useQuery({ queryKey: ["deltas", id], queryFn: () => getDeltas(client, id!), enabled: !!id });
  // #62 parity: the rank series carries observed-change annotations.
  const ranks = useQuery({ queryKey: ["ranks", id], queryFn: () => getRanks(client, id!), enabled: !!id });

  const [showCreds, setShowCreds] = useState(false);
  const [playAudit, setPlayAudit] = useState<PlayAudit | null>(null);

  // ASC read-and-improve: the .p8 is used once here and dropped (never stored).
  const asc = useMutation({
    mutationFn: (s: AscSubmit) => runAsc(client, id!, { ...s.cred }),
    onSuccess: (run) => router.push(`/(app)/runs/${run.id}`),
  });

  // Play own-app audit: verify the service account, then audit. Credential used
  // once across both calls and never persisted.
  const play = useMutation({
    mutationFn: async (s: PlaySubmit) => {
      const pkg = app.data?.app.bundle_id ?? "";
      const v = await verifyPlay(client, s.serviceAccount, pkg);
      if (!v.ok) throw new Error(v.reason ?? "service account could not access this app");
      return auditPlay(client, id!, { serviceAccount: s.serviceAccount, packageName: pkg });
    },
    onSuccess: (audit) => setPlayAudit(audit),
  });

  if (app.isLoading) {
    return <Centered><ActivityIndicator color={palette.signal} /></Centered>;
  }
  if (app.isError || !app.data) {
    return (
      <EmptyState
        title="Couldn’t load this app"
        detail={app.error instanceof Error ? app.error.message : "Try again."}
        cta={{ label: "Retry", onPress: () => void app.refetch() }}
      />
    );
  }

  const { app: a, runs } = app.data;

  return (
    <Screen>
      <Stack.Screen options={{ title: a.name, headerShown: true }} />
      <AppText kind="dim">{a.bundle_id} · {a.country}</AppText>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button label="War room" variant="ghost" onPress={() => router.push(`/(app)/war-room/${a.id}`)} />
        <Button label="Share a win" variant="ghost" onPress={() => void shareWin(a.id)} />
      </View>

      {deltas.data && deltas.data.entries.length > 0 ? (
        <Card>
          <AppText kind="lead">Rank movement</AppText>
          {deltas.data.entries.slice(0, 8).map((e) => (
            <RankMovementRow key={e.keyword} entry={e} />
          ))}
        </Card>
      ) : null}

      {ranks.data?.annotations && ranks.data.annotations.length > 0 ? (
        <View testID="rank-annotations">
        <Card>
          <AppText kind="lead">What changed</AppText>
          {ranks.data.annotations.slice(-8).map((an, i) => (
            <View key={`${an.at}-${i}`} style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs }}>
              <AppText kind="body" style={{ color: an.kind === "push" ? palette.signal : palette.warn }}>
                {an.kind === "push" ? "▲" : "◆"}
              </AppText>
              <View style={{ flex: 1 }}>
                <AppText kind="body">{an.label}</AppText>
                <AppText kind="micro">{an.at.slice(0, 10)}</AppText>
              </View>
            </View>
          ))}
          <AppText kind="micro" style={{ marginTop: spacing.sm }}>
            ▲ your approved pushes · ◆ competitor visible changes (their keyword fields aren’t
            public). Correlation, not causation — history starts when tracking started.
          </AppText>
        </Card>
        </View>
      ) : null}

      <CompetitorsCard client={client} appId={a.id} />
      <AgentTriggersCard client={client} appId={a.id} />

      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <AppText kind="lead">Credentialed audits</AppText>
          <Button label={showCreds ? "Hide" : "Connect"} variant="ghost" onPress={() => setShowCreds((v) => !v)} />
        </View>
        <AppText kind="micro">Read your live listing with your own keys — used once, never stored on this device.</AppText>
      </Card>

      {showCreds ? (
        <>
          <CredentialSheet variant="asc" onSubmit={(v) => asc.mutate(v as AscSubmit)} busy={asc.isPending} />
          {asc.isError ? <AppText kind="dim" style={{ color: palette.bad }}>{asc.error instanceof Error ? asc.error.message : "ASC run failed"}</AppText> : null}
          <CredentialSheet variant="play" onSubmit={(v) => play.mutate(v as PlaySubmit)} busy={play.isPending} />
          {play.isError ? <AppText kind="dim" style={{ color: palette.bad }}>{play.error instanceof Error ? play.error.message : "Play audit failed"}</AppText> : null}
        </>
      ) : null}

      {playAudit ? <PlayAuditView audit={playAudit} /> : null}

      <AppText kind="title">Runs</AppText>
      {runs.length === 0 ? (
        <AppText kind="dim">No runs yet.</AppText>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {runs.map((r) => (
            <Pressable key={r.id} testID={`run-${r.id}`} onPress={() => router.push(`/(app)/runs/${r.id}`)}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <AppText kind="body">{humanizeStatus(r.status)}</AppText>
                  <AppText kind="micro">{timeAgo(r.created_at, now)}</AppText>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
