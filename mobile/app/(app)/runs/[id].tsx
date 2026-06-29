/**
 * Run detail — "the money screen." Reads a run faithfully: findings (sorted),
 * screenshot grade + gallery + levers, coverage, keyword gaps / opportunities,
 * and the approval gate that reveals the handoff commands once approved. All
 * read-only consumption of server data; nothing pushes to a live store.
 */
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../src/auth/AuthProvider.js";
import { decideRun, getRun } from "../../../src/api/endpoints.js";
import { ApprovalGate } from "../../../src/components/ApprovalGate.js";
import { CoverageGauge } from "../../../src/components/CoverageGauge.js";
import { FindingCard, SurfaceLockCard } from "../../../src/components/FindingCard.js";
import { KeywordGapList, OpportunityList } from "../../../src/components/KeywordLists.js";
import { ScreenshotGallery } from "../../../src/components/ScreenshotGallery.js";
import { EmptyState } from "../../../src/components/EmptyState.js";
import { Screen, AppText, Button, Centered } from "../../../src/components/primitives.js";
import { downloadAndShareFastlane } from "../../../src/lib/fastlane.js";
import { palette, spacing } from "../../../src/theme/index.js";

export default function RunDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client } = useAuth();
  const qc = useQueryClient();

  const run = useQuery({
    queryKey: ["run", id],
    queryFn: () => getRun(client, id!),
    enabled: !!id,
  });

  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") => decideRun(client, id!, decision),
    onSuccess: (updated) => {
      qc.setQueryData(["run", id], updated);
      void qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });

  if (run.isLoading) {
    return <Centered><ActivityIndicator color={palette.signal} /></Centered>;
  }
  if (run.isError || !run.data) {
    return (
      <EmptyState
        title="Couldn’t load this run"
        detail={run.error instanceof Error ? run.error.message : "Try again."}
        cta={{ label: "Retry", onPress: () => void run.refetch() }}
      />
    );
  }

  const r = run.data.result;
  const screenshots = r.audit?.screenshots ?? null;
  const approved = run.data.status === "approved" || run.data.status === "shipped";

  return (
    <Screen>
      <Stack.Screen options={{ title: "Run", headerShown: true }} />

      <AppText kind="dim">{r.findingsSummary.label}</AppText>

      <ScreenshotGallery shots={screenshots} />

      {r.coverage ? <CoverageGauge coverage={r.coverage} /> : null}

      <ApprovalGate
        status={run.data.status}
        current={r.currentCopy}
        proposed={r.proposedCopy}
        pushCommands={r.pushCommands}
        onApprove={() => decide.mutate("approve")}
        onReject={() => decide.mutate("reject")}
        deciding={decide.isPending}
      />
      {decide.isError ? (
        <AppText kind="dim" style={{ color: palette.bad }}>
          {decide.error instanceof Error ? decide.error.message : "decision failed"}
        </AppText>
      ) : null}

      {approved ? (
        <Button
          label="Download fastlane metadata"
          variant="ghost"
          onPress={() => void downloadAndShareFastlane(id!)}
        />
      ) : null}

      <KeywordGapList gaps={r.keywordGaps} />
      <OpportunityList opportunities={r.opportunities} />

      {r.findings.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          <AppText kind="title">Findings</AppText>
          {r.findings.map((f) => <FindingCard key={f.id} finding={f} />)}
        </View>
      ) : null}

      {r.locks && r.locks.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          <AppText kind="title">Unlock more</AppText>
          {r.locks.map((l) => <SurfaceLockCard key={l.surface} lock={l} />)}
        </View>
      ) : null}
    </Screen>
  );
}
