/**
 * Capture kit (v1) — turn a screen recording of YOUR app into a planned store
 * screenshot set, on the phone where the recording lives:
 *
 *   1. record a walkthrough with iOS's built-in screen recorder (Control
 *      Center) while touring your app,
 *   2. import it here, scrub the real frames, pick the ones that show the story,
 *   3. pick a marketing frame style (or let ShipASO pick), plan the set,
 *   4. export the picked frames — rendering the framed set stays the explicit
 *      local/CI `render-shipshots.py` step, and nothing ships to a store from
 *      this screen. Approval is the terminus, everywhere.
 *
 * Honesty: every thumbnail IS a frame extracted from the recording — nothing is
 * synthesized. A failed extraction is a stated gap, never a placeholder image.
 */
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import * as Sharing from "expo-sharing";
import { useAuth } from "../../src/auth/AuthProvider.js";
import { ScreenshotPlanCard } from "../../src/components/ScreenshotPlanCard.js";
import { Screen, AppText, Button, Card } from "../../src/components/primitives.js";
import { spacing, usePalette } from "../../src/theme/index.js";

const THUMB_COUNT = 8;

type Extracted = { timeMs: number; uri: string };

export default function CaptureKit() {
  const palette = usePalette();
  const { client } = useAuth();
  const { appName } = useLocalSearchParams<{ appName?: string }>();

  const [busy, setBusy] = useState(false);
  const [video, setVideo] = useState<{ uri: string; durationMs: number } | null>(null);
  const [frames, setFrames] = useState<Extracted[]>([]);
  const [failedExtractions, setFailedExtractions] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const importRecording = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"] });
      const asset = res.canceled ? null : res.assets?.[0];
      if (!asset) return;
      const durationMs = asset.duration ?? 0;
      setVideo({ uri: asset.uri, durationMs });
      setFrames([]);
      setSelected([]);

      // evenly spaced REAL frames across the recording (mid-bucket sampling).
      const times = Array.from({ length: THUMB_COUNT }, (_, i) =>
        Math.floor((durationMs * (i + 0.5)) / THUMB_COUNT),
      );
      const out: Extracted[] = [];
      let failed = 0;
      for (const timeMs of times) {
        try {
          const t = await VideoThumbnails.getThumbnailAsync(asset.uri, { time: timeMs, quality: 1 });
          out.push({ timeMs, uri: t.uri });
        } catch {
          failed += 1; // a stated gap — never a placeholder image
        }
      }
      setFrames(out);
      setFailedExtractions(failed);
      if (out.length === 0) setNote("Couldn’t extract frames from that recording.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn’t import that recording.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (i: number) =>
    setSelected((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b)));

  // Selected frames become the plan's rawScreens, named in time order — the
  // same ids the renderer will expect as filename stems.
  const screenIds = selected.map((_, i) => `frame-${i + 1}`);

  const exportFrames = async () => {
    for (const i of selected) {
      const f = frames[i];
      if (f) await Sharing.shareAsync(f.uri);
    }
  };

  return (
    <Screen topInset={false}>
      <Stack.Screen options={{ title: "Capture kit", headerShown: true }} />
      <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
        <Card>
          <AppText kind="title">From recording to store set</AppText>
          <AppText kind="micro">
            Record a walkthrough of your app with the iOS screen recorder, import it here, pick the
            frames that tell the story. Rendering the framed set is your explicit local step — nothing
            ships to a store from this screen.
          </AppText>
          <Button
            testID="import-recording-btn"
            label={busy ? "Importing…" : video ? "Import a different recording" : "Import a screen recording"}
            onPress={() => void importRecording()}
            disabled={busy}
          />
          {busy ? <ActivityIndicator color={palette.signal} /> : null}
          {note ? (
            <AppText testID="capture-note" kind="micro">
              {note}
            </AppText>
          ) : null}
        </Card>

        {frames.length > 0 ? (
          <Card>
            <AppText kind="lead">Pick your frames</AppText>
            <AppText kind="micro">
              {frames.length} real frames from the recording — tap to select, in story order.
            </AppText>
            {failedExtractions > 0 ? (
              <AppText testID="extract-gaps" kind="micro">
                {failedExtractions} of {THUMB_COUNT} frames couldn’t be extracted.
              </AppText>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs }}>
              {frames.map((f, i) => {
                const pos = selected.indexOf(i);
                return (
                  <Pressable
                    key={f.timeMs}
                    testID={`thumb-${i}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: pos >= 0 }}
                    onPress={() => toggle(i)}
                    style={{
                      borderWidth: 2,
                      borderColor: pos >= 0 ? palette.signal : palette.line,
                      borderRadius: 6,
                      overflow: "hidden",
                    }}
                  >
                    <Image source={{ uri: f.uri }} style={{ width: 72, height: 152 }} />
                    {pos >= 0 ? (
                      <View
                        style={{
                          position: "absolute",
                          top: 2,
                          left: 2,
                          backgroundColor: palette.signal,
                          borderRadius: 4,
                          paddingHorizontal: 4,
                        }}
                      >
                        <AppText kind="micro" style={{ color: palette.onAccent }}>
                          {`frame-${pos + 1}`}
                        </AppText>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            {selected.length > 0 ? (
              <Button
                testID="export-frames-btn"
                variant="ghost"
                label={`Export ${selected.length} frame${selected.length === 1 ? "" : "s"}`}
                onPress={() => void exportFrames()}
              />
            ) : null}
          </Card>
        ) : null}

        {selected.length > 0 ? (
          <ScreenshotPlanCard
            client={client!}
            inputs={{
              appName: typeof appName === "string" && appName ? appName : "Your app",
              rawScreens: screenIds,
              audit: {
                recommendedCount: selected.length,
                findings: [`${selected.length} frames captured from a real walkthrough recording`],
              },
            }}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
