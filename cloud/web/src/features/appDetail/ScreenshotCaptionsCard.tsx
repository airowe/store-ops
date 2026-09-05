/**
 * Screenshot captions, localized (#78 item 3, v1-A) — the first product surface
 * on `POST /localize/screenshots`, which shipped curl-only in July.
 *
 * You describe the caption slots of your layered screenshot design (id, source
 * text, the box it must fit, its font size), pick the markets, and get back a
 * per-locale caption plan with an honest fit verdict on every slot:
 * `fit`, `shrunk` (to the size it landed on), or `overflow` (with the reason).
 * Nothing is rendered here and nothing ships: the manifest feeds the local
 * renderer (`lib/render_localized_shots.py`), which watermarks any locale the
 * engine flagged for review.
 *
 * Honest by construction: the verbatim draft caveat renders on every locale; an
 * overflow is stated, never clipped; a right-to-left locale comes back excluded
 * with the reason; a provider failure surfaces verbatim and yields no plan.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient, CaptionLocalizationResult, CaptionSlot, LocalizedCaptionSlot } from "@shipaso/api";
import { localizeScreenshotCaptions } from "@shipaso/api";

/** Markets the caption planner accepts; RTL entries are returned excluded by the engine. */
const LOCALES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "de-DE", label: "German" },
  { code: "fr-FR", label: "French" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "es-MX", label: "Spanish (Mexico)" },
  { code: "it", label: "Italian" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "nl-NL", label: "Dutch" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh-Hans", label: "Chinese (Simplified)" },
  { code: "zh-Hant", label: "Chinese (Traditional)" },
  { code: "ru", label: "Russian" },
  { code: "tr", label: "Turkish" },
  { code: "pl", label: "Polish" },
  { code: "sv", label: "Swedish" },
  { code: "ar-SA", label: "Arabic" },
  { code: "he", label: "Hebrew" },
];

type SlotRow = { id: string; text: string; width: string; height: string; fontSize: string };

/** Two slots most screenshot templates have: a headline and a sub-line. */
const DEFAULT_ROWS: SlotRow[] = [
  { id: "headline", text: "", width: "1000", height: "160", fontSize: "64" },
  { id: "sub", text: "", width: "1000", height: "120", fontSize: "32" },
];

function toSlot(r: SlotRow): CaptionSlot | null {
  const width = Number(r.width);
  const height = Number(r.height);
  const fontSize = Number(r.fontSize);
  if (!r.id.trim() || !r.text.trim() || !(width > 0) || !(height > 0) || !(fontSize > 0)) return null;
  return { id: r.id.trim(), text: r.text, box: { width, height }, fontSize };
}

/** The renderer's input: locale → slot → { text, fontSize at the FIT size }. */
export function captionManifest(
  result: CaptionLocalizationResult,
): Record<string, Record<string, { text: string; fontSize: number }>> {
  const out: Record<string, Record<string, { text: string; fontSize: number }>> = {};
  for (const set of result.localized) {
    const slots: Record<string, { text: string; fontSize: number }> = {};
    for (const s of set.slots) slots[s.id] = { text: s.text, fontSize: s.fit.fontSize };
    out[set.locale] = slots;
  }
  return out;
}

function fitText(s: LocalizedCaptionSlot): string {
  switch (s.fit.action) {
    case "fit":
      return `fits · ${s.fit.lines} line${s.fit.lines === 1 ? "" : "s"}`;
    case "shrunk":
      return `shrunk to ${s.fit.fontSize}px · ${s.fit.lines} line${s.fit.lines === 1 ? "" : "s"}${s.fit.note ? ` · ${s.fit.note}` : ""}`;
    case "overflow":
      return `overflow${s.fit.note ? ` · ${s.fit.note}` : ""}`;
  }
}

export function ScreenshotCaptionsCard({ client }: { client: ApiClient }) {
  const [rows, setRows] = useState<SlotRow[]>(DEFAULT_ROWS);
  const [brand, setBrand] = useState("");
  const [locales, setLocales] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  // A row with no caption is simply not a slot yet; a row WITH a caption but a
  // bad box or size blocks the run rather than being silently dropped.
  const filled = rows.filter((r) => r.text.trim() !== "");
  const slots = filled.map(toSlot).filter((s): s is CaptionSlot => s !== null);
  const ready = slots.length > 0 && slots.length === filled.length && locales.length > 0;

  const run = useMutation<CaptionLocalizationResult, Error, void>({
    mutationFn: () =>
      localizeScreenshotCaptions(client, {
        source: { slots },
        targetLocales: locales,
        brandTokens: brand.split(",").map((t) => t.trim()).filter(Boolean),
      }),
  });

  const setRow = (i: number, patch: Partial<SlotRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggle = (code: string) =>
    setLocales((ls) => (ls.includes(code) ? ls.filter((l) => l !== code) : [...ls, code]));

  const copyManifest = async () => {
    if (!run.data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(captionManifest(run.data), null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="card" data-testid="screenshot-captions-card">
      <b>Localize your screenshot captions</b>
      <p className="micro">
        Describe each caption slot of your screenshot design and pick the markets. You get a per-locale caption plan with
        an honest fit verdict on every slot. Nothing is rendered or shipped from here.
      </p>

      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr 70px 70px 64px auto", gap: 6, alignItems: "center" }}>
            <input data-testid={`sc-slot-id-${i}`} placeholder="slot id" value={r.id} onChange={(e) => setRow(i, { id: e.target.value })} />
            <input data-testid={`sc-slot-text-${i}`} placeholder="Source caption (English)" value={r.text} onChange={(e) => setRow(i, { text: e.target.value })} />
            <input data-testid={`sc-slot-w-${i}`} inputMode="numeric" placeholder="w px" value={r.width} onChange={(e) => setRow(i, { width: e.target.value })} />
            <input data-testid={`sc-slot-h-${i}`} inputMode="numeric" placeholder="h px" value={r.height} onChange={(e) => setRow(i, { height: e.target.value })} />
            <input data-testid={`sc-slot-size-${i}`} inputMode="numeric" placeholder="size" value={r.fontSize} onChange={(e) => setRow(i, { fontSize: e.target.value })} />
            <button type="button" className="btn" data-testid={`sc-remove-slot-${i}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove slot ${i + 1}`}>
              ×
            </button>
          </div>
        ))}
        <div>
          <button type="button" className="btn" data-testid="sc-add-slot" onClick={() => setRows((rs) => [...rs, { id: `slot${rs.length + 1}`, text: "", width: "1000", height: "120", fontSize: "32" }])}>
            Add a slot
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <input data-testid="sc-brand" placeholder="Brand words to keep verbatim, comma-separated" value={brand} onChange={(e) => setBrand(e.target.value)} style={{ width: "100%" }} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        {LOCALES.map((l) => (
          <label key={l.code} className="badge" style={{ cursor: "pointer", opacity: locales.includes(l.code) ? 1 : 0.7 }}>
            <input type="checkbox" data-testid={`sc-locale-${l.code}`} checked={locales.includes(l.code)} onChange={() => toggle(l.code)} style={{ marginRight: 4 }} />
            {l.label}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button type="button" className="btn" data-testid="sc-run" disabled={!ready || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Localizing…" : "Localize captions"}
        </button>
        {run.data ? (
          <button type="button" className="btn" data-testid="sc-copy-manifest" onClick={copyManifest}>
            {copied ? "Copied" : "Copy renderer manifest"}
          </button>
        ) : null}
      </div>

      {run.isError ? (
        <p className="micro" data-testid="sc-error">{run.error.message}</p>
      ) : null}

      {run.data ? (
        <div data-testid="sc-results" style={{ marginTop: 10 }}>
          {run.data.localized.map((set) => (
            <div key={set.locale} className="setting-row" data-testid={`sc-locale-result-${set.locale}`} style={{ display: "block" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <b>{set.locale}</b>
                <span className="micro">{set.label}</span>
                {set.needsReview ? (
                  <span className="badge" data-testid={`sc-review-${set.locale}`}>needs review</span>
                ) : null}
              </div>
              {set.slots.map((s) => (
                <div key={s.id} style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, marginTop: 4 }}>
                  <span className="micro">{s.id}</span>
                  <div>
                    <div>{s.text}</div>
                    <div className="micro" data-testid={`sc-fit-${set.locale}-${s.id}`}>{fitText(s)}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {run.data.excluded.length > 0 ? (
            <p className="micro" data-testid="sc-excluded">
              Not planned: {run.data.excluded.map((e) => `${e.locale} (${e.reason})`).join("; ")}
            </p>
          ) : null}
          <p className="micro">
            Render locally: save the manifest and run <code>python3 lib/render_localized_shots.py</code> over your background art. A locale flagged for review is watermarked by the renderer.
          </p>
        </div>
      ) : null}
    </div>
  );
}
