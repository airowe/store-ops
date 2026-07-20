/**
 * LocaleKeywordsCard (#180 Phase 3) — on-demand, market-native keyword ideas.
 * Pick a target storefront (curated chips, not free text — a mistyped locale
 * can't reach the server), optionally add seed terms, and see terms MEASURED
 * from the top apps in that market: each candidate carries how many of them use
 * it, so a suggestion is never an unsourced guess. Empty markets surface the
 * server's honest note verbatim, never a fabricated list.
 */
import { useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { getLocaleKeywords } from "../api/endpoints.js";
import type { LocaleKeywordsResult } from "../types/api.js";
import { palette, spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";
import { TextField } from "./TextField.js";

/**
 * Curated target storefronts — the localization loop's supported set. A closed
 * chip row (dependency-free), not a 39-locale picker: the markets we render
 * screenshots and copy for, so the user can't pick one the loop can't serve.
 */
const MARKETS: ReadonlyArray<{ code: string; label: string }> = [
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "de-DE", label: "German" },
  { code: "fr-FR", label: "French" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "it", label: "Italian" },
];

/** Split a comma/whitespace seed string into trimmed, non-empty terms. */
function parseSeeds(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function LocaleKeywordsCard({ client, appId }: { client: ApiClient; appId: string }) {
  const [market, setMarket] = useState("");
  const [seeds, setSeeds] = useState("");
  const [result, setResult] = useState<LocaleKeywordsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchIdeas() {
    if (!market) return;
    setBusy(true);
    setError(null);
    try {
      const terms = parseSeeds(seeds);
      const r = await getLocaleKeywords(client, appId, {
        market,
        ...(terms.length ? { seeds: terms } : {}),
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t fetch keyword ideas.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <AppText kind="lead">Market-native keywords</AppText>
      <AppText kind="micro">
        Terms measured from the top apps in a target storefront — pick a market to see what real
        apps there rank for. Add seed terms to steer the ideas.
      </AppText>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm }}>
        {MARKETS.map((m) => (
          <Button
            key={m.code}
            testID={`market-chip-${m.code}`}
            label={`${m.label} (${m.code})`}
            variant={market === m.code ? "primary" : "ghost"}
            onPress={() => setMarket(m.code)}
          />
        ))}
      </View>

      <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
        <TextField
          testID="locale-keywords-seeds"
          value={seeds}
          onChangeText={setSeeds}
          placeholder="Seed terms (optional, comma-separated)"
          onSubmitEditing={() => void fetchIdeas()}
        />
        <Button
          testID="locale-keywords-fetch"
          label="Get keyword ideas"
          variant="ghost"
          disabled={!market}
          loading={busy}
          onPress={() => void fetchIdeas()}
        />
      </View>

      {error ? (
        <AppText kind="micro" testID="locale-keywords-error" style={{ color: palette.bad }}>
          {error}
        </AppText>
      ) : null}

      {result ? (
        result.candidates.length === 0 ? (
          <AppText kind="dim" testID="locale-keywords-empty" style={{ marginTop: spacing.sm }}>
            {result.note ?? "No candidates for this market."}
          </AppText>
        ) : (
          <View style={{ marginTop: spacing.sm }}>
            {result.candidates.map((c) => (
              <View
                key={c.term}
                testID={`locale-kw-${c.term}`}
                style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs }}
              >
                <AppText kind="body" style={{ flex: 1 }}>
                  {c.term}
                </AppText>
                <AppText kind="micro">
                  used by {c.usedByCount} top app{c.usedByCount === 1 ? "" : "s"}
                </AppText>
              </View>
            ))}
          </View>
        )
      ) : null}
    </Card>
  );
}
