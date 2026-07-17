/**
 * Dashboard — the connected apps list + connect/search, mirroring the web's
 * dashboard. Authed (the `(app)` guard ensures it). React Query owns the apps
 * fetch; connecting an app routes to its detail (Phase 2) and refreshes the list.
 */
import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../src/auth/AuthProvider.js";
import { connectApp, listApps } from "../../src/api/endpoints.js";
import { AppCard } from "../../src/components/AppCard.js";
import { ConnectPicker } from "../../src/components/ConnectPicker.js";
import { EmptyState } from "../../src/components/EmptyState.js";
import { Grid } from "../../src/components/Grid.js";
import { Screen, AppText, Button, Centered } from "../../src/components/primitives.js";
import { ActivityIndicator } from "react-native";
import { useLayout } from "../../src/theme/responsive.js";
import { palette } from "../../src/theme/index.js";
import type { AppCandidate } from "../../src/types/api.js";

export default function Dashboard() {
  const { client, me } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const now = Date.now();
  const { columns } = useLayout();

  const apps = useQuery({
    queryKey: ["apps"],
    queryFn: () => listApps(client),
  });

  const connect = useMutation({
    mutationFn: (c: AppCandidate) => connectApp(client, { bundle_id: c.bundleId, query: c.name }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["apps"] });
      if ("id" in res) router.push(`/(app)/apps/${res.id}`);
    },
  });

  return (
    <Screen topInset={false}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <AppText kind="title">Your apps</AppText>
        <View style={{ flexDirection: "row", gap: 4 }}>
          <Button label="Portfolio" variant="ghost" onPress={() => router.push("/(app)/portfolio")} />
          {/* sign-out moved into Settings (with device-token cleanup) */}
          <Button label="Settings" variant="ghost" onPress={() => router.push("/(app)/settings")} />
        </View>
      </View>
      {me?.email ? <AppText kind="micro">{me.email}{me.via === "demo" ? " · demo" : ""}</AppText> : null}

      <ConnectPicker client={client} onConnect={(c) => connect.mutate(c)} />
      {connect.isPending ? <AppText kind="dim">Connecting…</AppText> : null}
      {connect.isError ? (
        <AppText kind="dim" style={{ color: palette.bad }}>
          {connect.error instanceof Error ? connect.error.message : "connect failed"}
        </AppText>
      ) : null}

      {apps.isLoading ? (
        <Centered><ActivityIndicator color={palette.signal} /></Centered>
      ) : apps.isError ? (
        <EmptyState
          title="Couldn’t load your apps"
          detail={apps.error instanceof Error ? apps.error.message : "Try again."}
          cta={{ label: "Retry", onPress: () => void apps.refetch() }}
        />
      ) : (apps.data?.apps.length ?? 0) === 0 ? (
        <EmptyState title="No apps connected yet" detail="Search above to connect your first app." />
      ) : (
        <Grid columns={columns}>
          {apps.data!.apps.map((a) => (
            <AppCard key={a.id} app={a} now={now} onPress={(id) => router.push(`/(app)/apps/${id}`)} />
          ))}
        </Grid>
      )}
    </Screen>
  );
}
