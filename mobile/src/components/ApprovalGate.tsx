/**
 * ApprovalGate — the human gate. The proposed-copy diff is always visible, but
 * the **push commands stay hidden until the run is approved** and are NEVER
 * executed on the client — they're a copyable handoff. This mirrors the server's
 * privacy boundary (pushCommands is `[]` until approval) and the product rule:
 * no auto-push to a live store.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { palette, radius, spacing } from "../theme/index.js";
import type { CopyFields, PushCommand } from "../types/api.js";
import { AppText, Button, Card } from "./primitives.js";

export function ApprovalGate({
  status,
  current,
  proposed,
  pushCommands,
  onApprove,
  onReject,
  deciding,
}: {
  status: string;
  current: CopyFields;
  proposed: CopyFields;
  pushCommands: PushCommand[];
  onApprove: () => void;
  onReject: () => void;
  deciding?: boolean;
}) {
  const approved = status === "approved" || status === "shipped";
  const rejected = status === "rejected";
  // A superseded run (a newer run replaced it) is a dead iteration — never
  // pending, so it shows no Approve/Reject; it reads as resolved.
  const superseded = status === "superseded";
  const pending = !approved && !rejected && !superseded;

  return (
    <Card>
      <AppText kind="lead">Proposed changes</AppText>
      <CopyDiff current={current} proposed={proposed} />

      {pending ? (
        <View style={styles.actions}>
          <Button label="Approve" onPress={onApprove} loading={!!deciding} testID="approve" />
          <Button label="Reject" variant="ghost" onPress={onReject} disabled={!!deciding} testID="reject" />
        </View>
      ) : (
        <AppText kind="dim" style={{ color: approved ? palette.signal : palette.dim }}>
          {approved ? "Approved" : superseded ? "Superseded by a newer run" : "Rejected"}
        </AppText>
      )}

      {/* Handoff commands appear ONLY after approval — and are copy targets, never run here. */}
      {approved && pushCommands.length > 0 ? (
        <View style={styles.handoff} testID="handoff">
          <AppText kind="lead">Handoff commands</AppText>
          <AppText kind="micro">Run these yourself — ShipASO never pushes to a live store.</AppText>
          {pushCommands.map((c, i) => (
            <View key={i} style={styles.cmd}>
              <AppText kind="micro" style={{ color: palette.dim }}>{c.description}</AppText>
              <AppText kind="mono" selectable>{c.command}</AppText>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const COPY_FIELDS: Array<keyof CopyFields> = ["name", "subtitle", "keywords", "promo"];

function CopyDiff({ current, proposed }: { current: CopyFields; proposed: CopyFields }) {
  return (
    <View style={{ gap: spacing.sm, marginVertical: spacing.sm }}>
      {COPY_FIELDS.map((f) => {
        const before = current[f];
        const after = proposed[f];
        if (after === undefined) return null; // nothing proposed for this field
        const changed = before !== after;
        return (
          <View key={f} style={styles.diff} testID={`diff-${f}`}>
            <AppText kind="micro">{f}</AppText>
            {before !== undefined ? (
              <AppText kind="body" style={changed ? styles.before : undefined}>{before || "—"}</AppText>
            ) : (
              <AppText kind="dim">(was unread)</AppText>
            )}
            {changed ? <AppText kind="body" style={{ color: palette.signal }}>{after || "—"}</AppText> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  handoff: { marginTop: spacing.md, gap: spacing.sm, borderTopColor: palette.line, borderTopWidth: 1, paddingTop: spacing.md },
  cmd: { gap: 2, backgroundColor: palette.bg2, borderColor: palette.line, borderWidth: 1, borderRadius: radius.base, padding: spacing.sm },
  diff: { gap: 2 },
  before: { color: palette.faint, textDecorationLine: "line-through" },
});
