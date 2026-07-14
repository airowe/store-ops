/**
 * Preview — try-before-signup. Audit any live listing on real data; sign in only
 * when you want to RUN the fix. Signup is gated at VALUE, not behind a cold
 * login wall — a new install can see a real audit before being asked for an
 * email. Mirrors the web's PreviewView against the same public POST /preview.
 *
 * Honest: the grade and findings are exactly what the Worker returned. We never
 * inflate a grade to make the funnel look better — the teaser is real, and the
 * payoff (optimized copy + push commands) is what's withheld until signup.
 */
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { useOptionalAuth } from "../../src/auth/AuthProvider.js";
import { preview } from "../../src/api/endpoints.js";
import type { ApiClient } from "../../src/api/client.js";
import type { PreviewCandidate, PreviewResult } from "../../src/types/api.js";
import { Screen, AppText, Button, Card } from "../../src/components/primitives.js";
import { TextField } from "../../src/components/TextField.js";
import { palette, spacing } from "../../src/theme/index.js";

type Teaser = NonNullable<PreviewResult["preview"]>;

/** `client` is injectable so tests can drive the screen without an AuthProvider. */
export default function Preview({ client: injected }: { client?: ApiClient } = {}) {
  const auth = useOptionalAuth();
  const client = injected ?? auth?.client;
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<PreviewCandidate[] | null>(null);
  const [result, setResult] = useState<Teaser | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function apply(r: PreviewResult) {
    if (r.needsChoice) {
      setCandidates(r.candidates ?? []);
      setResult(null);
      setNote((r.candidates ?? []).length === 0 ? "No apps found. Try a name, store link, or bundle id." : null);
    } else if (r.preview) {
      setResult(r.preview);
      setCandidates(null);
      setNote(null);
    } else {
      setNote(r.error ?? "Couldn’t preview that app.");
    }
  }

  /**
   * A no-match is an HTTP 404 with `{ error: "no app found for …" }`, so the
   * client THROWS and onSuccess never runs. Without this the failure path is
   * silent — a typo produces no feedback at all. Surface the server's message.
   */
  function fail(e: unknown) {
    setCandidates(null);
    setResult(null);
    setNote(e instanceof Error ? e.message : "Couldn’t preview that app.");
  }

  /** Clear the previous note when a new request starts — otherwise the error from
   *  the LAST query sits on screen while the new one is still auditing. */
  const startFresh = () => setNote(null);

  // The public route group has no auth guard, so there is always a client in the
  // app; the null case only arises in a standalone unit mount.
  const search = useMutation({
    mutationFn: (q: string) => preview(client!, { query: q }),
    onMutate: startFresh,
    onSuccess: apply,
    onError: fail,
  });
  // An ambiguous query hands back a pick-list; re-post the chosen bundle_id.
  const pick = useMutation({
    mutationFn: (bundle_id: string) => preview(client!, { bundle_id }),
    onMutate: startFresh,
    onSuccess: apply,
    onError: fail,
  });

  const busy = search.isPending || pick.isPending;

  return (
    <Screen>
      <Stack.Screen options={{ title: "Try it", headerShown: false }} />
      <AppText kind="title">Try it — free, no signup</AppText>
      <AppText kind="dim">
        Audit any live App Store listing on real data. Sign in only when you want to run the fix.
      </AppText>

      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
        <TextField
          testID="preview-query"
          value={query}
          onChangeText={setQuery}
          placeholder="App name or bundle id"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => query.trim() && search.mutate(query.trim())}
        />
        <Button
          testID="preview-search"
          label={search.isPending ? "Auditing…" : "Audit"}
          disabled={!query.trim() || busy}
          loading={search.isPending}
          onPress={() => search.mutate(query.trim())}
        />
      </View>

      {note ? (
        <AppText kind="dim" testID="preview-note" style={{ marginTop: spacing.sm }}>
          {note}
        </AppText>
      ) : null}

      {candidates?.map((c) => (
        <Pressable key={c.bundle_id} testID={`pcand-${c.bundle_id}`} onPress={() => pick.mutate(c.bundle_id)}>
          <Card>
            <AppText kind="body">{c.name}</AppText>
            <AppText kind="micro">{c.bundle_id}</AppText>
          </Card>
        </Pressable>
      ))}

      {result ? (
        <View testID="preview-result">
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AppText kind="lead">{result.appName || "Audit preview"}</AppText>
            {result.auditGrade ? (
              <AppText kind="mono" testID="preview-grade" style={{ color: palette.signal }}>
                {result.auditGrade}
              </AppText>
            ) : null}
          </View>

          <AppText kind="body" testID="preview-summary">
            {result.leadKeyword && result.leadRank != null
              ? `Ranks #${result.leadRank} for “${result.leadKeyword}” · ${result.inTop10} of ${result.keywordsChecked} tracked keywords in the top 10.`
              : `Checked ${result.keywordsChecked} keywords — none ranking yet.`}
          </AppText>

          {result.sample.length ? (
            <View style={{ gap: spacing.xs, marginTop: spacing.sm }} testID="preview-sample">
              {result.sample.map((s) => (
                <View key={s.keyword} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <AppText kind="micro">{s.keyword}</AppText>
                  {/* An unmeasured rank is "—", never a fabricated number. */}
                  <AppText kind="mono">{s.rank == null ? "—" : `#${s.rank}`}</AppText>
                </View>
              ))}
            </View>
          ) : null}

          {/* The gate: value first, signup second. */}
          <View
            style={{
              marginTop: spacing.md,
              paddingTop: spacing.sm,
              borderTopWidth: 1,
              borderTopColor: palette.line,
              gap: spacing.xs,
            }}
          >
            <AppText kind="body">Connect &amp; run</AppText>
            <AppText kind="micro">
              Sign in to run the fix and prepare the push — your credentials, your machine.
            </AppText>
            <Button
              testID="preview-signin"
              label="Sign in to run"
              onPress={() => router.push("/(public)/login")}
            />
          </View>
        </Card>
        </View>
      ) : null}
    </Screen>
  );
}
