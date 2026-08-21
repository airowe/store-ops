/**
 * "ShipASO opened this run on its own" — and what it saw.
 *
 * This is the screen a push notification opens. The notification says a fix is
 * ready; without this the reader is asked to approve a change with no account
 * of why it exists. The agent's observations were measured and persisted, and
 * the person being asked to approve is the one who should see them.
 *
 * The decision logic mirrors the web `runTrigger` model rather than importing
 * it — mobile mirrors shared shapes by convention (see src/types/api.ts) rather
 * than depending on @shipaso/api. The two must agree, so the honesty rules are
 * tested on BOTH sides:
 *
 *   1. An unrecognized `source` is never narrated as an agent decision. It
 *      falls through to the neutral wording rather than crediting the agent.
 *   2. Reasons render verbatim or not at all. No reasons means no list — never
 *      a plausible-sounding stand-in.
 */
import { View } from "react-native";
import { AppText } from "./primitives.js";
import { spacing } from "../theme/index.js";

/** Mirrors the shared @shipaso/api `RunTrigger`. */
export type RunTrigger = {
  source: "manual" | "cron" | "connect";
  reasons: string[];
};

type Narration = { actor: "agent" | "human" | "system"; headline: string };

function narrate(source: RunTrigger["source"]): Narration {
  switch (source) {
    case "cron":
      return { actor: "agent", headline: "ShipASO opened this run on its own." };
    case "manual":
      return { actor: "human", headline: "You asked for this run." };
    case "connect":
      return { actor: "system", headline: "First look, from when this app was connected." };
    default:
      // Fails closed: a source added later must not be credited to the agent.
      return { actor: "system", headline: "This run was opened automatically." };
  }
}

export function RunTriggerNote({ trigger }: { trigger?: RunTrigger | null | undefined }) {
  // No trigger ⇒ nothing to say. An older run predating the field gets silence,
  // not a reconstruction.
  if (!trigger) return null;

  const { actor, headline } = narrate(trigger.source);
  const reasons = Array.isArray(trigger.reasons) ? trigger.reasons : [];

  return (
    <View style={{ gap: spacing.xs }} testID="run-trigger">
      <AppText kind={actor === "agent" ? "lead" : "body"}>{headline}</AppText>
      {reasons.length > 0 ? (
        <View style={{ gap: 2 }} testID="run-trigger-reasons">
          {reasons.map((r) => (
            <AppText key={r} kind="dim">
              {`· ${r}`}
            </AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
}
