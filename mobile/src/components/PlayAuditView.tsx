/**
 * PlayAuditView — renders a connected-tier Google Play audit (own-app, via the
 * service-account). reliable:true means no capability locks and a genuine grade;
 * still honest about unmeasured fields. Play has NO keyword field, so it's simply
 * absent — never shown as an empty 0/100.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { palette, spacing } from "../theme/index.js";
import { formatScore } from "../lib/format.js";
import type { PlayAudit } from "../types/api.js";
import { FindingCard } from "./FindingCard.js";
import { AppText, Card } from "./primitives.js";

export function PlayAuditView({ audit }: { audit: PlayAudit }) {
  const s = audit.screenshots;
  const listing = audit.listing;
  return (
    <View style={{ gap: spacing.md }} testID="play-audit">
      <Card>
        <View style={styles.headerRow}>
          <AppText kind="lead">Google Play audit</AppText>
          <AppText kind="mono" style={{ color: palette.signal }}>{s.grade} · {formatScore(s.score)}</AppText>
        </View>
        <AppText kind="dim">{audit.summary.label}</AppText>
        {/* Honest field readout — null = unmeasured (em-dash), "" = measured-empty. */}
        <FieldLine label="Title" value={listing.title} />
        <FieldLine label="Short description" value={listing.tagline} />
        <AppText kind="micro">
          {s.primaryCount} phone screenshot{s.primaryCount === 1 ? "" : "s"} graded
        </AppText>
      </Card>

      <Card>
        <View style={styles.headerRow}>
          <AppText kind="lead">Indexed-text coverage</AppText>
          <AppText kind="mono" style={{ color: palette.signal }}>{audit.coverage.coverageScore}/100</AppText>
        </View>
        {audit.coverage.stuffingRisk ? (
          <AppText kind="dim" style={{ color: palette.warn }}>Possible keyword stuffing in the long description.</AppText>
        ) : (
          <AppText kind="micro">{audit.coverage.distinctTerms} distinct non-brand terms</AppText>
        )}
      </Card>

      {audit.findings.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          {audit.findings.map((f) => <FindingCard key={f.id} finding={f} />)}
        </View>
      ) : null}
    </View>
  );
}

function FieldLine({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.field}>
      <AppText kind="micro">{label}</AppText>
      {value === null ? (
        <AppText kind="dim">— (unmeasured)</AppText>
      ) : value === "" ? (
        <AppText kind="dim">(empty)</AppText>
      ) : (
        <AppText kind="body">{value}</AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  field: { gap: 2, marginTop: spacing.xs },
});
