/**
 * RenderSetCard — the on-device pixel step of ShipShots: a planned set + the
 * captured frames → full-resolution (1290×2796) store screenshots, rendered
 * with Skia right on the phone. Previews are visible on every tier so the
 * value is seen before the paywall; EXPORT (full-res files via the share
 * sheet) requires Indie or above, offered through the native RevenueCat
 * paywall inline — the Shipaton IAP sells the flagship feature.
 *
 * Honesty: previews are the REAL renders (same bytes the export shares, shown
 * small); a shot that fails to render is a stated gap, never a blank; a
 * needs-review shot carries its DRAFT watermark everywhere, including export.
 * Nothing uploads to a store from here — `asc screenshots upload` stays the
 * explicit step.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { ApiClient } from "../api/client.js";
import { getScreenshotTemplates } from "../api/endpoints.js";
import type { FrameCatalog, ScreenshotPlan, Tier } from "../types/api.js";
import { NEUTRAL_BG, buildShotRender, parseHex, type RGB } from "../lib/shotRender.js";
import { renderShotToBase64 } from "../lib/skiaShotRenderer.js";
import { spacing, usePalette } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";
import { Paywall } from "./Paywall.js";

export const CANVAS_W = 1290;
export const CANVAS_H = 2796;

type Rendered = { name: string; base64: string | null; needsReview: boolean };

export function RenderSetCard({
  client,
  plan,
  frames,
  tier,
  onUnlocked,
}: {
  client: ApiClient;
  plan: ScreenshotPlan;
  /** captured screens by sourceScreen id (frame-1 → file uri). */
  frames: Record<string, string>;
  tier?: Tier | undefined;
  onUnlocked?: (() => void) | undefined;
}) {
  const palette = usePalette();
  const [catalog, setCatalog] = useState<FrameCatalog | null>(null);
  const [bg, setBg] = useState<string>("neutral");
  const [rendered, setRendered] = useState<Rendered[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getScreenshotTemplates(client)
      .then((c) => {
        if (alive && c && Array.isArray(c.templates) && c.templates.length > 0) setCatalog(c);
      })
      .catch(() => {
        /* no catalog → the card states it below instead of guessing layouts */
      });
    return () => {
      alive = false;
    };
  }, [client]);

  const background: RGB = bg === "neutral" ? NEUTRAL_BG : (parseHex(bg) ?? NEUTRAL_BG);

  const renderSet = async () => {
    if (!catalog) return;
    setBusy(true);
    setNote(null);
    try {
      const out: Rendered[] = [];
      for (let i = 0; i < plan.shots.length; i++) {
        const shot = plan.shots[i]!;
        // an unknown templateId coerces to the first catalog frame — the same
        // safe default the Python bridge uses (never a guessed layout).
        const template =
          catalog.templates.find((t) => t.id === shot.templateId) ?? catalog.templates[0]!;
        const render = buildShotRender({
          shot,
          template,
          canvasWidth: CANVAS_W,
          canvasHeight: CANVAS_H,
          frameUri: frames[shot.sourceScreen] ?? null,
          background,
        });
        const base64 = await renderShotToBase64(render);
        out.push({
          name: `${String(i + 1).padStart(2, "0")}-${template.id}.png`,
          base64,
          needsReview: render.needsReview,
        });
      }
      setRendered(out);
      const failed = out.filter((r) => r.base64 === null).length;
      if (failed > 0) setNote(`${failed} of ${out.length} shots failed to render.`);
    } finally {
      setBusy(false);
    }
  };

  const exportSet = async () => {
    if (tier === undefined || tier === "free") {
      setShowPaywall(true);
      return;
    }
    if (!rendered) return;
    for (const r of rendered) {
      if (r.base64 === null) continue;
      const dest = `${FileSystem.cacheDirectory}${r.name}`;
      await FileSystem.writeAsStringAsync(dest, r.base64, { encoding: "base64" });
      await Sharing.shareAsync(dest);
    }
  };

  const exportable = rendered?.filter((r) => r.base64 !== null).length ?? 0;

  return (
    <Card>
      <AppText kind="title">Render the set</AppText>
      <AppText kind="micro">
        Full App Store resolution ({CANVAS_W}×{CANVAS_H}), rendered on this phone. Nothing uploads
        to a store from here.
      </AppText>

      {plan.palette && plan.palette.length > 0 ? (
        <View style={{ flexDirection: "row", gap: spacing.xs, marginTop: spacing.xs, alignItems: "center" }}>
          <AppText kind="micro">Background</AppText>
          <Pressable
            testID="bg-neutral"
            accessibilityRole="button"
            accessibilityState={{ selected: bg === "neutral" }}
            onPress={() => setBg("neutral")}
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: 4,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: bg === "neutral" ? palette.signal : palette.line,
            }}
          >
            <AppText kind="micro">Neutral</AppText>
          </Pressable>
          {plan.palette.map((hex) => (
            <Pressable
              key={hex}
              testID={`bg-${hex.slice(1)}`}
              accessibilityRole="button"
              accessibilityState={{ selected: bg === hex }}
              onPress={() => setBg(hex)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                backgroundColor: hex,
                borderWidth: 2,
                borderColor: bg === hex ? palette.signal : palette.line,
              }}
            />
          ))}
        </View>
      ) : null}

      {catalog ? (
        <Button
          testID="render-set-btn"
          label={busy ? "Rendering…" : rendered ? "Re-render" : "Render set"}
          onPress={() => void renderSet()}
          disabled={busy}
        />
      ) : (
        <AppText kind="micro">Frame catalog unavailable — can’t render without real layouts.</AppText>
      )}
      {busy ? <ActivityIndicator color={palette.signal} /> : null}
      {note ? (
        <AppText testID="render-note" kind="micro">
          {note}
        </AppText>
      ) : null}

      {rendered ? (
        <ScrollView horizontal contentContainerStyle={{ gap: spacing.xs, marginTop: spacing.sm }}>
          {rendered.map((r, i) => (
            <View key={r.name} style={{ alignItems: "center" }}>
              {r.base64 !== null ? (
                <Image
                  testID={`render-preview-${i}`}
                  source={{ uri: `data:image/png;base64,${r.base64}` }}
                  style={{ width: 92, height: 199, borderRadius: 6, borderWidth: 1, borderColor: palette.line }}
                />
              ) : (
                <View
                  testID={`render-failed-${i}`}
                  style={{ width: 92, height: 199, borderRadius: 6, borderWidth: 1, borderColor: palette.bad, alignItems: "center", justifyContent: "center" }}
                >
                  <AppText kind="micro">failed</AppText>
                </View>
              )}
              <AppText kind="micro">{r.name}</AppText>
              {r.needsReview ? (
                <AppText testID={`render-draft-${i}`} kind="micro" style={{ color: palette.warn }}>
                  DRAFT
                </AppText>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : null}

      {rendered && exportable > 0 ? (
        <Button
          testID="export-set-btn"
          label={`Export ${exportable} PNG${exportable === 1 ? "" : "s"} (full res)`}
          onPress={() => void exportSet()}
        />
      ) : null}

      {showPaywall ? (
        <View testID="render-paywall" style={{ marginTop: spacing.sm }}>
          <AppText kind="micro">Full-resolution export is an Indie feature.</AppText>
          <Paywall
            {...(tier !== undefined ? { tier } : {})}
            onDone={() => {
              setShowPaywall(false);
              onUnlocked?.();
            }}
          />
        </View>
      ) : null}
    </Card>
  );
}
