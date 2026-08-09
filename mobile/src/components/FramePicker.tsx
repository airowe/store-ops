/**
 * FramePicker — choose the marketing frame a screenshot set is planned in, from
 * the shared catalog (GET /screenshot-templates), or leave it on "Let ShipASO
 * pick" (the default: no lock, the planner assigns a frame per shot).
 *
 * Each option draws a live mini-preview from the catalog's fraction geometry —
 * the same numbers the renderer draws with, so the preview can't drift from the
 * pixels. If the catalog fetch fails, the picker renders nothing and the choice
 * stays "auto": a degraded network never fakes a catalog.
 */
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { getScreenshotTemplates } from "../api/endpoints.js";
import type { FrameCatalog, FrameTemplate } from "../types/api.js";
import { spacing, usePalette } from "../theme/index.js";
import { AppText } from "./primitives.js";

/** "auto" or a catalog frame id. */
export type FrameChoice = string;

const PREVIEW_W = 44;
const PREVIEW_H = 92;

/** The catalog geometry at thumbnail scale: device rect + caption bars. */
function FramePreview({ template, active }: { template: FrameTemplate; active: boolean }) {
  const palette = usePalette();
  const px = (f: number, span: number) => Math.round(f * span);
  const d = template.deviceFrame;
  return (
    <View
      style={{
        width: PREVIEW_W,
        height: PREVIEW_H,
        borderRadius: 4,
        backgroundColor: palette.bg,
        borderWidth: 1,
        borderColor: active ? palette.signal : palette.line,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          position: "absolute",
          left: px(d.fx, PREVIEW_W),
          top: px(d.fy, PREVIEW_H),
          width: px(d.fw, PREVIEW_W),
          height: px(d.fh, PREVIEW_H),
          backgroundColor: palette.line,
          borderRadius: 2,
        }}
      />
      {Object.entries(template.slots).map(([slotId, b]) => (
        <View
          key={slotId}
          style={{
            position: "absolute",
            left: px(b.fx, PREVIEW_W),
            top: px(b.fy, PREVIEW_H),
            width: px(b.fw, PREVIEW_W),
            height: Math.max(2, Math.round(px(b.fh, PREVIEW_H) / 3)),
            backgroundColor: active ? palette.signal : palette.dim,
            borderRadius: 1,
            alignSelf: b.align === "left" ? "flex-start" : undefined,
          }}
        />
      ))}
    </View>
  );
}

export function FramePicker({
  client,
  choice,
  onChoose,
}: {
  client: ApiClient;
  choice: FrameChoice;
  onChoose: (choice: FrameChoice) => void;
}) {
  const palette = usePalette();
  const [catalog, setCatalog] = useState<FrameCatalog | null>(null);

  useEffect(() => {
    let alive = true;
    getScreenshotTemplates(client)
      .then((c) => {
        // only a real catalog renders a picker — a malformed answer is treated
        // like a failed fetch, never partially drawn.
        if (alive && c && Array.isArray(c.templates) && c.templates.length > 0 && c.auto) {
          setCatalog(c);
        }
      })
      .catch(() => {
        /* no catalog → no picker; the choice stays "auto" */
      });
    return () => {
      alive = false;
    };
  }, [client]);

  if (!catalog) return null;

  const active = choice === "auto"
    ? catalog.auto
    : catalog.templates.find((t) => t.id === choice) ?? catalog.auto;

  return (
    <View testID="frame-picker" style={{ marginTop: spacing.sm }}>
      <AppText kind="micro">Frame style</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs }}>
        <Pressable
          testID="frame-auto"
          accessibilityRole="button"
          accessibilityState={{ selected: choice === "auto" }}
          onPress={() => onChoose("auto")}
          style={{
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: choice === "auto" ? palette.signal : palette.line,
            justifyContent: "center",
          }}
        >
          <AppText kind={choice === "auto" ? "body" : "dim"}>{catalog.auto.name}</AppText>
        </Pressable>
        {catalog.templates.map((t) => (
          <Pressable
            key={t.id}
            testID={`frame-${t.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: choice === t.id }}
            onPress={() => onChoose(t.id)}
            style={{ alignItems: "center", gap: 2 }}
          >
            <FramePreview template={t} active={choice === t.id} />
            <AppText kind="micro">{t.name}</AppText>
          </Pressable>
        ))}
      </View>
      <AppText testID="frame-sell" kind="micro" style={{ marginTop: spacing.xs }}>
        {active.sell}
      </AppText>
    </View>
  );
}
