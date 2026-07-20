/**
 * LocalizationCard (#78) — the mobile per-market review gate. On an APPROVED run,
 * generate a localized draft of the approved copy, review it (caveat + any trimmed
 * fields), and approve it. Approved locales feed the Fastlane bundle + per-locale
 * push; remove drops a locale.
 *
 * Honest by construction:
 *   • we localize the copy you APPROVED, never the unapproved draft;
 *   • the verbatim machine-translation caveat is rendered, never softened;
 *   • trimmed fields are stated, not hidden;
 *   • RTL drafts are ALLOWED and rendered right-to-left (shown correctly, never
 *     dropped or rendered broken);
 *   • the approved-locale set is the SERVER's, not an optimistic guess.
 */
import { useState } from "react";
import { View, type TextStyle } from "react-native";
import type { ApiClient } from "../api/client.js";
import { localizeApprove, localizeGenerate, localizeRemove } from "../api/endpoints.js";
import type { LocalizedDraft } from "../types/api.js";
import { palette, spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";

/**
 * Curated target markets — the localization loop's supported set, plus Arabic to
 * exercise the RTL path. A closed chip row (dependency-free), not a 39-locale
 * picker: a mistyped locale can't reach the server.
 */
const LOCALES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "de-DE", label: "German" },
  { code: "fr-FR", label: "French" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "it", label: "Italian" },
  { code: "ar-SA", label: "Arabic" },
];

/**
 * Right-to-left language subtags (mirrors the engine's RTL_LANGS). RTL COPY is
 * allowed — unlike RTL screenshots — but must render right-to-left so it reads
 * correctly rather than broken.
 */
const RTL_LANGS = new Set(["ar", "he", "iw", "fa", "ur", "ps", "sd", "ug", "yi", "dv"]);
function isRtl(locale: string): boolean {
  return RTL_LANGS.has(locale.split("-")[0]!.toLowerCase());
}

const FIELDS: Array<keyof LocalizedDraft["copy"]> = ["name", "subtitle", "keywords"];

export function LocalizationCard({
  client,
  runId,
  status,
  initialLocales,
}: {
  client: ApiClient;
  runId: string;
  status: string;
  initialLocales: string[];
}) {
  const approvedRun = status === "approved" || status === "shipped";
  const [approved, setApproved] = useState<string[]>(initialLocales);
  const [locale, setLocale] = useState("");
  const [draft, setDraft] = useState<LocalizedDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!locale) return;
    setBusy("generate");
    setError(null);
    try {
      setDraft(await localizeGenerate(client, runId, locale));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Translation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function approve(d: LocalizedDraft) {
    setBusy("approve");
    setError(null);
    try {
      const r = await localizeApprove(client, runId, d.locale, d.copy);
      setApproved(r.approved);
      setDraft(null);
      setLocale("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(l: string) {
    setBusy(`remove-${l}`);
    setError(null);
    try {
      const r = await localizeRemove(client, runId, l);
      setApproved(r.approved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t remove the locale.");
    } finally {
      setBusy(null);
    }
  }

  if (!approvedRun) {
    return (
      <Card>
        <AppText kind="lead">Localize the approved copy</AppText>
        <AppText kind="dim" testID="localization-locked">
          Approve this run first — localization translates the copy you approved, so it unlocks once
          the run is approved.
        </AppText>
      </Card>
    );
  }

  const draftRtl = draft ? isRtl(draft.locale) : false;
  const fieldStyle: TextStyle | undefined = draftRtl
    ? { writingDirection: "rtl", textAlign: "right" }
    : undefined;

  return (
    <Card>
      <AppText kind="lead">Localize the approved copy</AppText>
      <AppText kind="micro">
        Generate a localized draft per market. We localize what you approved — never the draft.
      </AppText>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm }}>
        {LOCALES.filter((l) => !approved.includes(l.code)).map((l) => (
          <Button
            key={l.code}
            testID={`loc-chip-${l.code}`}
            label={`${l.label} (${l.code})`}
            variant={locale === l.code ? "primary" : "ghost"}
            onPress={() => setLocale(l.code)}
          />
        ))}
      </View>

      <View style={{ marginTop: spacing.sm }}>
        <Button
          testID="loc-generate"
          label="Generate"
          variant="ghost"
          disabled={!locale}
          loading={busy === "generate"}
          onPress={() => void generate()}
        />
      </View>

      {error ? (
        <AppText kind="micro" testID="loc-error" style={{ color: palette.bad }}>
          {error}
        </AppText>
      ) : null}

      {draft ? (
        <Card style={{ marginTop: spacing.sm }}>
          <AppText kind="micro">
            Draft for <AppText kind="body">{draft.locale}</AppText>:
          </AppText>
          {draft.label ? (
            <AppText kind="micro" testID="loc-caveat" style={{ color: palette.warn }}>
              {draft.label}
            </AppText>
          ) : null}
          {FIELDS.map((f) =>
            draft.copy[f] ? (
              <AppText key={f} kind="body" testID={`loc-field-${f}`} style={fieldStyle}>
                {f}: {draft.copy[f]}
              </AppText>
            ) : null,
          )}
          {draft.trimmed.length > 0 ? (
            <AppText kind="micro" testID="loc-trimmed">
              Trimmed to fit: {draft.trimmed.join(", ")}.
            </AppText>
          ) : null}
          <Button
            testID="loc-approve"
            label={`Approve ${draft.locale}`}
            loading={busy === "approve"}
            onPress={() => void approve(draft)}
          />
        </Card>
      ) : null}

      {approved.length > 0 ? (
        <View testID="loc-approved" style={{ marginTop: spacing.sm }}>
          <AppText kind="micro">Approved locales (in the handoff):</AppText>
          {approved.map((l) => (
            <View
              key={l}
              testID={`loc-approved-${l}`}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs }}
            >
              <AppText kind="mono" style={{ flex: 1 }}>
                {l}
              </AppText>
              <Button
                testID={`loc-remove-${l}`}
                label="Remove"
                variant="ghost"
                loading={busy === `remove-${l}`}
                onPress={() => void remove(l)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
