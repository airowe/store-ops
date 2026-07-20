/**
 * Per-locale localization (#78) — previously curl-only. On an APPROVED run,
 * generate a localized draft of the approved copy for a locale, review it
 * (including any fields TRIMMED to fit App Store limits), and approve it. Approved
 * locales feed the Fastlane bundle + per-locale push; remove drops a locale.
 *
 * Honest: we localize the copy you APPROVED, never the draft; a translation
 * failure surfaces verbatim (never a fake translation); trimmed fields are stated,
 * not hidden. The approved-locale set comes from the server, not an optimistic guess.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient, CopyFields, LocalizedDraft } from "@shipaso/api";
import { localizeApprove, localizeGenerate, localizeRemove } from "@shipaso/api";

const FIELDS: Array<keyof CopyFields> = ["name", "subtitle", "keywords"];

/**
 * App Store Connect localization codes (a curated common subset). A closed
 * dropdown, not free text — an invalid/mistyped locale can't reach the server,
 * and the labels make the market obvious.
 */
const LOCALES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "en-US", label: "English (U.S.)" },
  { code: "en-GB", label: "English (U.K.)" },
  { code: "en-AU", label: "English (Australia)" },
  { code: "en-CA", label: "English (Canada)" },
  { code: "fr-FR", label: "French" },
  { code: "fr-CA", label: "French (Canada)" },
  { code: "de-DE", label: "German" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "es-MX", label: "Spanish (Mexico)" },
  { code: "it", label: "Italian" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "pt-PT", label: "Portuguese (Portugal)" },
  { code: "nl-NL", label: "Dutch" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh-Hans", label: "Chinese (Simplified)" },
  { code: "zh-Hant", label: "Chinese (Traditional)" },
  { code: "ru", label: "Russian" },
  { code: "ar-SA", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "tr", label: "Turkish" },
  { code: "sv", label: "Swedish" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "no", label: "Norwegian" },
  { code: "pl", label: "Polish" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "ms", label: "Malay" },
  { code: "he", label: "Hebrew" },
  { code: "el", label: "Greek" },
  { code: "cs", label: "Czech" },
  { code: "hu", label: "Hungarian" },
  { code: "ro", label: "Romanian" },
  { code: "uk", label: "Ukrainian" },
  { code: "ca", label: "Catalan" },
  { code: "hr", label: "Croatian" },
  { code: "sk", label: "Slovak" },
];

export function LocalizationCard({ client, runId, initialLocales }: { client: ApiClient; runId: string; initialLocales: string[] }) {
  const [approved, setApproved] = useState<string[]>(initialLocales);
  const [locale, setLocale] = useState("");
  const [draft, setDraft] = useState<LocalizedDraft | null>(null);

  const generate = useMutation({ mutationFn: (l: string) => localizeGenerate(client, runId, l), onSuccess: setDraft });
  const approve = useMutation({
    mutationFn: (d: LocalizedDraft) => localizeApprove(client, runId, d.locale, d.copy),
    onSuccess: (r) => { setApproved(r.approved); setDraft(null); setLocale(""); },
  });
  const remove = useMutation({ mutationFn: (l: string) => localizeRemove(client, runId, l), onSuccess: (r) => setApproved(r.approved) });
  const busy = generate.isPending || approve.isPending || remove.isPending;

  return (
    <div className="card" data-testid="localization-card">
      <b>Localize the approved copy</b>
      <p className="micro">Generate a localized draft per market. We localize what you approved — never the draft.</p>

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <select
          data-testid="loc-locale"
          aria-label="Market to localize into"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">Select a market…</option>
          {LOCALES.filter((l) => !approved.includes(l.code)).map((l) => (
            <option key={l.code} value={l.code}>
              {l.label} ({l.code})
            </option>
          ))}
        </select>
        <button type="button" className="btn" data-testid="loc-generate" disabled={busy || !locale.trim()} onClick={() => generate.mutate(locale.trim())}>
          {generate.isPending ? "Translating…" : "Generate"}
        </button>
      </div>
      {generate.isError ? (
        <p className="micro" data-testid="loc-error">{generate.error instanceof Error ? generate.error.message : "Translation failed."}</p>
      ) : null}

      {draft ? (
        <div className="card" data-testid="loc-draft" style={{ marginTop: 8 }}>
          <p className="micro">Draft for <b>{draft.locale}</b>:</p>
          {draft.label ? (
            <p className="micro" data-testid="loc-caveat"><b>{draft.label}</b></p>
          ) : null}
          {FIELDS.map((f) => (draft.copy[f] ? (
            <p key={f} className="micro"><span className="fname">{f}</span>: {draft.copy[f]}</p>
          ) : null))}
          {draft.trimmed.length > 0 ? (
            <p className="micro" data-testid="loc-trimmed">Trimmed to fit: {draft.trimmed.join(", ")}.</p>
          ) : null}
          <button type="button" className="btn primary" data-testid="loc-approve" disabled={busy} onClick={() => approve.mutate(draft)}>
            {approve.isPending ? "Approving…" : `Approve ${draft.locale}`}
          </button>
        </div>
      ) : null}

      {approved.length > 0 ? (
        <div data-testid="loc-approved" style={{ marginTop: 8 }}>
          <p className="micro">Approved locales (in the handoff):</p>
          {approved.map((l) => (
            <div key={l} className="setting-row" data-testid={`loc-${l}`}>
              <span style={{ flex: 1 }} className="mono">{l}</span>
              <button type="button" className="btn ghost" data-testid={`loc-remove-${l}`} disabled={busy} onClick={() => remove.mutate(l)}>Remove</button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
