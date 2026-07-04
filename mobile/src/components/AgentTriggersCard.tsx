/**
 * Agent triggers + sweep schedule (#53/#52 parity) — per-app config on mobile.
 * Honesty framing baked in, same as web: thresholds gate what OPENS A RUN
 * (what nags you), never what the agent measures; snapshots record every sweep
 * regardless. Save reconciles from the server's answer; invalid input fails
 * loud (the Worker 400s and the message is shown verbatim).
 */
import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { getSchedule, getThresholds, setSchedule, setThresholds } from "../api/endpoints.js";
import type { SweepSchedule, ThresholdConfig } from "../types/api.js";
import { AppText, Button, Card } from "./primitives.js";
import { TextField } from "./TextField.js";
import { palette, spacing } from "../theme/index.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const CADENCES: Array<{ value: SweepSchedule["cadence"]; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "2 weeks" },
];

export function AgentTriggersCard({ client, appId }: { client: ApiClient; appId: string }) {
  const [unranked, setUnranked] = useState(true);
  const [compChanges, setCompChanges] = useState(true);
  const [notifyOnly, setNotifyOnly] = useState(false);
  const [drop, setDrop] = useState("");
  const [mutedKw, setMutedKw] = useState("");
  const [sched, setSched] = useState<SweepSchedule>({ cadence: "weekly", day: 1, hourUtc: 9 });
  const [hour, setHour] = useState("9");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const fillThresholds = (t: ThresholdConfig) => {
    setUnranked(t.unranked);
    setCompChanges(t.competitorChanges);
    setNotifyOnly(t.notifyOnly);
    setDrop(t.rankDropAtLeast == null ? "" : String(t.rankDropAtLeast));
    setMutedKw(t.mutedKeywords.join(", "));
  };
  const fillSchedule = (s: SweepSchedule) => {
    setSched(s);
    setHour(String(s.hourUtc));
  };

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([getThresholds(client, appId), getSchedule(client, appId)]);
      fillThresholds(t.thresholds);
      fillSchedule(s.schedule);
    } catch {
      /* fail-open — defaults already rendered */
    }
  }, [client, appId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveTriggers() {
    setBusy("triggers");
    setNote(null);
    try {
      const dropTrim = drop.trim();
      const r = await setThresholds(client, appId, {
        unranked,
        competitorChanges: compChanges,
        notifyOnly,
        rankDropAtLeast: dropTrim === "" ? null : Number(dropTrim),
        mutedKeywords: mutedKw.split(",").map((s) => s.trim()).filter(Boolean),
      });
      fillThresholds(r.thresholds); // reconcile from the server's answer
      setNote("Saved. Snapshots still record every sweep — these only change what opens a run.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn’t save.");
    } finally {
      setBusy(null);
    }
  }

  async function saveSchedule() {
    setBusy("schedule");
    setNote(null);
    try {
      const r = await setSchedule(client, appId, {
        cadence: sched.cadence,
        day: sched.day,
        hourUtc: Number(hour.trim()),
      });
      fillSchedule(r.schedule);
      setNote("Saved — the agent sweeps this app on that slot from now on.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn’t save the schedule.");
    } finally {
      setBusy(null);
    }
  }

  const toggle = (testID: string, value: boolean, onPress: () => void) => (
    <Button testID={testID} label={value ? "On" : "Off"} variant="ghost" onPress={onPress} />
  );

  return (
    <Card>
      <AppText kind="lead">Agent triggers</AppText>
      <AppText kind="micro">
        Tune what opens a run for your approval. The agent still measures everything every sweep —
        these only decide when it asks for your attention.
      </AppText>

      <Row title="Unranked keyword opens a run" action={toggle("th-unranked", unranked, () => setUnranked(!unranked))} />
      <Row title="Competitor change opens a run" action={toggle("th-competitors", compChanges, () => setCompChanges(!compChanges))} />
      <Row title="Notify only — never open runs" action={toggle("th-notify-only", notifyOnly, () => setNotifyOnly(!notifyOnly))} />
      <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
        <AppText kind="micro">Open a run when a rank drops ≥ N places week-over-week (blank = off)</AppText>
        <TextField testID="th-rank-drop" value={drop} onChangeText={setDrop} placeholder="off" keyboardType="number-pad" />
        <AppText kind="micro">Muted keywords (never trigger, comma-separated)</AppText>
        <TextField testID="th-muted" value={mutedKw} onChangeText={setMutedKw} placeholder="e.g. recipe, pantry" />
      </View>
      <Button testID="th-save" label="Save triggers" variant="ghost" loading={busy === "triggers"} onPress={() => void saveTriggers()} />

      <View style={{ borderTopWidth: 1, borderTopColor: palette.line, marginTop: spacing.md, paddingTop: spacing.sm, gap: spacing.xs }}>
        <AppText kind="body">Sweep schedule</AppText>
        <AppText kind="micro">When the autonomous sweep runs for this app. Default: weekly, Monday 09:00 UTC.</AppText>
        <View style={{ flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" }}>
          {CADENCES.map((c) => (
            <Button
              key={c.value}
              testID={`sch-${c.value}`}
              label={c.label}
              variant={sched.cadence === c.value ? "primary" : "ghost"}
              onPress={() => setSched({ ...sched, cadence: c.value })}
            />
          ))}
        </View>
        {sched.cadence !== "daily" ? (
          <View style={{ flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" }}>
            {DAYS.map((d, i) => (
              <Button
                key={d}
                testID={`sch-day-${i}`}
                label={d}
                variant={sched.day === i ? "primary" : "ghost"}
                onPress={() => setSched({ ...sched, day: i })}
              />
            ))}
          </View>
        ) : null}
        <AppText kind="micro">Hour (UTC, 0–23)</AppText>
        <TextField testID="sch-hour" value={hour} onChangeText={setHour} keyboardType="number-pad" />
        <Button testID="sch-save" label="Save schedule" variant="ghost" loading={busy === "schedule"} onPress={() => void saveSchedule()} />
      </View>

      {note ? (
        <View testID="triggers-note" style={{ marginTop: spacing.sm }}>
          <AppText kind="micro">{note}</AppText>
        </View>
      ) : null}
    </Card>
  );
}

function Row({ title, action }: { title: string; action: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <AppText kind="body">{title}</AppText>
      </View>
      {action}
    </View>
  );
}
