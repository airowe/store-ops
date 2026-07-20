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
import { decideRun, getCredentials, getGithubStatus, getRun } from "../../../src/api/endpoints.js";
import { ApprovalGate } from "../../../src/components/ApprovalGate.js";
import { AscPushCard } from "../../../src/components/AscPushCard.js";
import { GithubPrCard } from "../../../src/components/GithubPrCard.js";
import { CoverageGauge } from "../../../src/components/CoverageGauge.js";
import { FindingCard, SurfaceLockCard } from "../../../src/components/FindingCard.js";
import { KeywordGapList, OpportunityList } from "../../../src/components/KeywordLists.js";
import { LocalizationCard } from "../../../src/components/LocalizationCard.js";
import { LocalizationExpansionCard } from "../../../src/components/LocalizationExpansionCard.js";
import { PpoTreatmentCard } from "../../../src/components/PpoTreatmentCard.js";
import { ScreenshotPlanCard } from "../../../src/components/ScreenshotPlanCard.js";
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

  // GitHub metadata-PR path (#8): drives the credential-free ship action below.
  // A status read failure just hides the card (retry:false — never a dead button).
  const github = useQuery({
    queryKey: ["github", "status"],
    queryFn: () => getGithubStatus(client),
    retry: false,
  });

  // #270: a stored ASC key unlocks one-tap Push. retry:false so a failed read
  // just hides the push card (never a dead button).
  const creds = useQuery({ queryKey: ["credentials"], queryFn: () => getCredentials(client), retry: false });

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
  // #270: the stored ASC key that can push THIS run — app-scoped or a global key.
  const storedAscKey = (creds.data?.credentials ?? []).find(
    (c) => c.kind === "asc" && (c.appId === run.data.app_id || c.appId === null),
  );
  // #71-C: status is what IS, fixes are what to DO. Partition once — the guard and
  // the rendered list then read the same array and can't drift apart.
  const fixes = r.findings.filter((f) => !f.context);
  const status = r.findings.filter((f) => f.context);

  return (
    <Screen topInset={false}>
      <Stack.Screen options={{ title: "Run", headerShown: true }} />

      <AppText kind="dim">{r.findingsSummary.label}</AppText>

      <ScreenshotGallery shots={screenshots} />

      {r.coverage ? <CoverageGauge coverage={r.coverage} /> : null}

      {r.ppoTreatment ? <PpoTreatmentCard plan={r.ppoTreatment} /> : null}

      {screenshots ? (
        <ScreenshotPlanCard
          client={client}
          inputs={{
            appName: r.proposedCopy.name ?? r.currentCopy.name ?? r.audit.liveName ?? "",
            ...(r.proposedCopy.subtitle ? { subtitle: r.proposedCopy.subtitle } : {}),
            keywords: (r.proposedCopy.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean),
            rawScreens: [],
            audit: {
              grade: screenshots.grade,
              // App Store minimum-strong set when the audit carries no explicit target.
              recommendedCount: 6,
              findings: screenshots.findings,
            },
            brandPalette: [],
          }}
        />
      ) : null}

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

      <AscPushCard
        client={client}
        runId={id!}
        approved={approved}
        storedKeyId={storedAscKey?.keyId ?? null}
      />

      <GithubPrCard
        client={client}
        runId={id!}
        approved={approved}
        connected={github.data?.connected ?? false}
        repo={github.data?.repo ?? null}
      />

      <LocalizationExpansionCard recommendations={r.localizationExpansion} />
      <LocalizationCard
        client={client}
        runId={id!}
        status={run.data.status}
        initialLocales={Object.keys(r.localizedCopy ?? {}).sort()}
      />

      <KeywordGapList gaps={r.keywordGaps} />
      <OpportunityList opportunities={r.opportunities} />

      {fixes.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          <AppText kind="title">Findings</AppText>
          {fixes.map((f) => <FindingCard key={f.id} finding={f} />)}
        </View>
      ) : null}

      {/* #71-C parity: STATUS/CONTEXT findings render in their own compact strip. */}
      {status.length > 0 ? (
        <View testID="listing-status" style={{ gap: spacing.xs }}>
          <AppText kind="title">Listing status</AppText>
          {status.map((f) => (
            <View key={f.id} style={{ marginTop: spacing.xs }}>
              <AppText kind="body">{f.title}</AppText>
              {f.detail ? <AppText kind="micro">{f.detail}</AppText> : null}
            </View>
          ))}
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
